//! Writing a read/unread change back to the provider.
//!
//! Two features need the same thing: the per-selection batch action
//! ([`super::batch::batch_mark_read`]) and the account-wide "mark all as read"
//! action ([`super::mark_all_read::mark_account_all_read`]). They differ only in
//! how they pick their targets, so the provider fan-out lives here.
//!
//! Every provider is asked in bulk when it can be:
//!
//! - Gmail gets one `messages.batchModify` call per 1000 ids.
//! - IMAP gets one `UID STORE` per 500 uids **per mailbox**, instead of one
//!   `SELECT` + `STORE` per message.
//! - Outlook has no cheap bulk read-state endpoint wired up, so it stays
//!   per-message.
//!
//! Failures keep the contract the batch action already had: a provider that
//! could not be reached at all is queued *and* committed locally (the user's
//! intent is visible immediately and retried in the background), while a single
//! message rejected by a reachable provider is only queued, so the message stays
//! unread until the retry succeeds.

use super::messages::find_message_folder;
use super::messages::provider_dispatch::{parse_imap_uid, ConnectedProvider};
use crate::state::AppState;
use pebble_core::traits::LabelProvider;
use pebble_core::{PebbleError, ProviderType};
use pebble_mail::{GMAIL_BATCH_MODIFY_LIMIT, IMAP_STORE_UID_BATCH};
use serde_json::json;
use std::collections::HashMap;
use tracing::{info, warn};

/// One message whose read flag must be written to the provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteFlagTarget {
    pub message_id: String,
    /// Provider-side identifier: IMAP uid, Gmail id, or Outlook id.
    pub remote_id: String,
    /// IMAP only: the mailbox owning `remote_id`. When absent the writer looks
    /// the owning folder up locally, which costs one query per message — bulk
    /// callers are expected to resolve it up front.
    pub folder_remote_id: Option<String>,
}

impl RemoteFlagTarget {
    pub(crate) fn new(message_id: impl Into<String>, remote_id: impl Into<String>) -> Self {
        Self {
            message_id: message_id.into(),
            remote_id: remote_id.into(),
            folder_remote_id: None,
        }
    }

    pub(crate) fn with_folder(
        message_id: impl Into<String>,
        remote_id: impl Into<String>,
        folder_remote_id: Option<String>,
    ) -> Self {
        Self {
            message_id: message_id.into(),
            remote_id: remote_id.into(),
            folder_remote_id,
        }
    }
}

/// How a provider fan-out ended for one account.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct RemoteReadFlagSync {
    /// Messages the provider acknowledged.
    pub succeeded: Vec<String>,
    /// Messages queued for retry whose local flag may be committed now.
    pub queued_for_local_commit: Vec<String>,
}

/// Push `is_read` for every target to the account's provider.
pub(crate) async fn sync_read_flag_remote(
    state: &AppState,
    account_id: &str,
    provider_type: &ProviderType,
    targets: &[RemoteFlagTarget],
    is_read: bool,
) -> std::result::Result<RemoteReadFlagSync, PebbleError> {
    if targets.is_empty() {
        return Ok(RemoteReadFlagSync::default());
    }

    // POP3 keeps flags only on this device; there is nothing to write remotely.
    if matches!(provider_type, ProviderType::Pop3) {
        return Ok(RemoteReadFlagSync {
            succeeded: targets.iter().map(|t| t.message_id.clone()).collect(),
            queued_for_local_commit: Vec::new(),
        });
    }

    match ConnectedProvider::connect(state, account_id, provider_type).await {
        Ok(conn) => {
            let sync = match &conn {
                ConnectedProvider::Gmail(provider) => {
                    let (add, remove) = gmail_read_labels(is_read);
                    let mut sync = RemoteReadFlagSync::default();
                    for chunk in targets.chunks(GMAIL_BATCH_MODIFY_LIMIT) {
                        let ids: Vec<String> = chunk.iter().map(|t| t.remote_id.clone()).collect();
                        match provider.batch_modify_messages(&ids, &add, &remove).await {
                            Ok(()) => sync
                                .succeeded
                                .extend(chunk.iter().map(|t| t.message_id.clone())),
                            Err(bulk_error) => {
                                // batchModify is all-or-nothing, so one bad id
                                // would strand the whole chunk.
                                warn!(
                                    "Gmail bulk read-flag update failed for {} messages, \
                                     falling back to per-message: {bulk_error}",
                                    chunk.len()
                                );
                                for target in chunk {
                                    match provider
                                        .modify_labels(&target.remote_id, &add, &remove)
                                        .await
                                    {
                                        Ok(()) => sync.succeeded.push(target.message_id.clone()),
                                        Err(e) => queue_read_flag_op(
                                            state,
                                            account_id,
                                            target,
                                            is_read,
                                            &e.to_string(),
                                            false,
                                            &mut sync,
                                        )?,
                                    }
                                }
                            }
                        }
                    }
                    Ok(sync)
                }
                ConnectedProvider::Imap(imap) => {
                    sync_imap_read_flags(state, account_id, imap, targets, is_read).await
                }
                ConnectedProvider::Outlook(provider) => {
                    let mut sync = RemoteReadFlagSync::default();
                    for target in targets {
                        match provider
                            .update_read_status(&target.remote_id, is_read)
                            .await
                        {
                            Ok(()) => sync.succeeded.push(target.message_id.clone()),
                            Err(e) => queue_read_flag_op(
                                state,
                                account_id,
                                target,
                                is_read,
                                &e.to_string(),
                                false,
                                &mut sync,
                            )?,
                        }
                    }
                    Ok(sync)
                }
            };
            conn.disconnect().await;
            sync
        }
        Err(e) => {
            let error = e.to_string();
            let mut sync = RemoteReadFlagSync::default();
            for target in targets {
                queue_read_flag_op(state, account_id, target, is_read, &error, true, &mut sync)?;
            }
            Ok(sync)
        }
    }
}

/// The Gmail label change that represents a read/unread write.
pub(crate) fn gmail_read_labels(is_read: bool) -> (Vec<String>, Vec<String>) {
    if is_read {
        (Vec::new(), vec!["UNREAD".to_string()])
    } else {
        (vec!["UNREAD".to_string()], Vec::new())
    }
}

/// Group IMAP targets by mailbox so each mailbox costs one `SELECT` and one
/// `UID STORE` per 500 uids.
async fn sync_imap_read_flags(
    state: &AppState,
    account_id: &str,
    imap: &pebble_mail::ImapProvider,
    targets: &[RemoteFlagTarget],
    is_read: bool,
) -> std::result::Result<RemoteReadFlagSync, PebbleError> {
    let mut sync = RemoteReadFlagSync::default();
    // mailbox -> (uid, target index)
    let mut by_folder: HashMap<String, Vec<(u32, usize)>> = HashMap::new();

    for (index, target) in targets.iter().enumerate() {
        let folder_remote_id = match target.folder_remote_id.clone() {
            Some(folder) => Some(folder),
            None => find_message_folder(state, &target.message_id, account_id)
                .ok()
                .map(|folder| folder.remote_id),
        };
        let Some(folder_remote_id) = folder_remote_id else {
            queue_read_flag_op(
                state,
                account_id,
                target,
                is_read,
                "Source folder lookup failed",
                false,
                &mut sync,
            )?;
            continue;
        };

        match parse_imap_uid(&target.remote_id) {
            Ok(uid) => by_folder
                .entry(folder_remote_id)
                .or_default()
                .push((uid, index)),
            Err(_) => queue_read_flag_op(
                state,
                account_id,
                target,
                is_read,
                "Invalid IMAP UID",
                false,
                &mut sync,
            )?,
        }
    }

    // Sorted so the command order (and therefore the logs) are reproducible.
    let mut mailboxes: Vec<String> = by_folder.keys().cloned().collect();
    mailboxes.sort();

    for mailbox in mailboxes {
        let entries = by_folder.remove(&mailbox).unwrap_or_default();
        for chunk in entries.chunks(IMAP_STORE_UID_BATCH) {
            let uids: Vec<u32> = chunk.iter().map(|(uid, _)| *uid).collect();
            match imap.set_flags_bulk(&mailbox, &uids, is_read).await {
                Ok(()) => sync.succeeded.extend(entries_to_ids(targets, chunk)),
                Err(bulk_error) => {
                    warn!(
                        "IMAP bulk read-flag update failed for {} messages in {mailbox}, \
                         falling back to per-message: {bulk_error}",
                        chunk.len()
                    );
                    for (uid, index) in chunk {
                        let target = &targets[*index];
                        match imap.set_flags(&mailbox, *uid, Some(is_read), None).await {
                            Ok(()) => sync.succeeded.push(target.message_id.clone()),
                            Err(e) => queue_read_flag_op(
                                state,
                                account_id,
                                target,
                                is_read,
                                &e.to_string(),
                                false,
                                &mut sync,
                            )?,
                        }
                    }
                }
            }
        }
    }

    Ok(sync)
}

fn entries_to_ids(targets: &[RemoteFlagTarget], entries: &[(u32, usize)]) -> Vec<String> {
    entries
        .iter()
        .map(|(_, index)| targets[*index].message_id.clone())
        .collect()
}

/// Queue a failed remote write as a pending operation so the retry worker can
/// finish it, and optionally allow the local flag to be committed right away.
fn queue_read_flag_op(
    state: &AppState,
    account_id: &str,
    target: &RemoteFlagTarget,
    is_read: bool,
    error: &str,
    commit_locally: bool,
    sync: &mut RemoteReadFlagSync,
) -> std::result::Result<(), PebbleError> {
    let payload = json!({
        "provider_account_id": account_id,
        "remote_id": target.remote_id,
        "op": "update_flags",
        "payload": {
            "folder_remote_id": target.folder_remote_id,
            "is_read": is_read,
            "is_starred": null,
        },
    });
    let op_id = state.store.insert_pending_mail_op(
        account_id,
        &target.message_id,
        "update_flags",
        &payload.to_string(),
    )?;
    state.store.mark_pending_mail_op_failed(&op_id, error)?;
    if commit_locally {
        sync.queued_for_local_commit.push(target.message_id.clone());
    }
    info!(
        "Queued read-flag retry for message {}: {error}",
        target.message_id
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gmail_read_labels_add_and_remove_the_unread_label() {
        assert_eq!(
            gmail_read_labels(true),
            (Vec::new(), vec!["UNREAD".to_string()])
        );
        assert_eq!(
            gmail_read_labels(false),
            (vec!["UNREAD".to_string()], Vec::new())
        );
    }

    #[test]
    fn entries_to_ids_maps_back_to_targets() {
        let targets = vec![
            RemoteFlagTarget::new("m1", "1"),
            RemoteFlagTarget::new("m2", "2"),
            RemoteFlagTarget::new("m3", "3"),
        ];

        assert_eq!(
            entries_to_ids(&targets, &[(30, 2), (10, 0)]),
            vec!["m3".to_string(), "m1".to_string()]
        );
    }
}
