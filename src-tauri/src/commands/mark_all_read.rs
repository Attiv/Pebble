//! Account-wide "mark all as read" — one click per mailbox.
//!
//! The scope of "unread" is the store's unread-mail scope (unread, not deleted,
//! and not filed exclusively under drafts, trash or spam), which is the same
//! scope the app badge counts. That keeps the two features honest: the number a
//! user sees on the badge is the number this command clears.
//!
//! Unlike the selection-based batch action, this action is unbounded — a mailbox
//! can hold thousands of unread messages — so the provider fan-out is chunked
//! and bulk wherever the provider allows it. See [`super::read_flags`].

use super::read_flags::{sync_read_flag_remote, RemoteFlagTarget, RemoteReadFlagSync};
use crate::badge;
use crate::state::AppState;
use pebble_core::{PebbleError, ProviderType};
use pebble_store::messages::UnreadMessageRef;
use std::collections::HashSet;
use tauri::State;
use tracing::info;

/// Messages whose read flag may be committed locally: everything the provider
/// acknowledged, plus everything queued because the provider was unreachable.
///
/// A message rejected by a reachable provider is deliberately excluded — it
/// stays unread until the queued retry succeeds, matching the batch action.
fn local_commit_ids(refs: &[UnreadMessageRef], sync: &RemoteReadFlagSync) -> Vec<String> {
    let committable: HashSet<&str> = sync
        .succeeded
        .iter()
        .chain(sync.queued_for_local_commit.iter())
        .map(String::as_str)
        .collect();
    refs.iter()
        .filter(|reference| committable.contains(reference.message_id.as_str()))
        .map(|reference| reference.message_id.clone())
        .collect()
}

#[tauri::command]
pub async fn mark_account_all_read(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<u32, PebbleError> {
    let store = state.store.clone();
    let lookup_id = account_id.clone();
    let (refs, provider_type) = tokio::task::spawn_blocking(
        move || -> std::result::Result<(Vec<UnreadMessageRef>, Option<ProviderType>), PebbleError> {
            let refs = store.list_unread_message_refs(&lookup_id)?;
            let provider_type = store.get_account(&lookup_id)?.map(|account| account.provider);
            Ok((refs, provider_type))
        },
    )
    .await
    .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))??;

    if refs.is_empty() {
        return Ok(0);
    }
    let provider_type = provider_type
        .ok_or_else(|| PebbleError::Validation(format!("Unknown account: {account_id}")))?;

    let targets: Vec<RemoteFlagTarget> = refs
        .iter()
        .map(|reference| {
            RemoteFlagTarget::with_folder(
                reference.message_id.clone(),
                reference.remote_id.clone(),
                reference.folder_remote_id.clone(),
            )
        })
        .collect();

    let sync = sync_read_flag_remote(&state, &account_id, &provider_type, &targets, true).await?;
    let ids_to_update = local_commit_ids(&refs, &sync);

    if !ids_to_update.is_empty() {
        let changes: Vec<(String, Option<bool>, Option<bool>)> = ids_to_update
            .iter()
            .map(|id| (id.clone(), Some(true), None))
            .collect();
        let store = state.store.clone();
        tokio::task::spawn_blocking(move || store.bulk_update_flags(&changes))
            .await
            .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))??;
    }

    let cleared = ids_to_update.len() as u32;
    info!(
        "Marked all as read for account {account_id}: {cleared}/{} unread messages cleared",
        refs.len()
    );
    badge::request_refresh(&app);
    Ok(cleared)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference(message_id: &str) -> UnreadMessageRef {
        UnreadMessageRef {
            message_id: message_id.to_string(),
            remote_id: message_id.to_string(),
            folder_id: None,
            folder_remote_id: Some("INBOX".to_string()),
        }
    }

    #[test]
    fn local_commit_keeps_request_order_and_skips_remote_only_failures() {
        let refs = vec![reference("m1"), reference("m2"), reference("m3")];
        let sync = RemoteReadFlagSync {
            succeeded: vec!["m3".to_string()],
            queued_for_local_commit: vec!["m1".to_string()],
        };

        // m2 was rejected by a reachable provider: queued for retry, not cleared.
        assert_eq!(
            local_commit_ids(&refs, &sync),
            vec!["m1".to_string(), "m3".to_string()]
        );
    }

    #[test]
    fn local_commit_is_empty_when_every_remote_write_failed() {
        let refs = vec![reference("m1"), reference("m2")];

        assert!(local_commit_ids(&refs, &RemoteReadFlagSync::default()).is_empty());
    }
}
