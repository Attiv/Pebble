use crate::badge;
use crate::state::AppState;
use pebble_core::traits::LabelProvider;
use pebble_core::{Message, PebbleError, ProviderType};
use pebble_mail::{ImapConfig, ImapProvider};
use serde_json::json;
use tauri::{Manager, State};

use super::{
    connect_gmail, connect_outlook, load_imap_config, queue_pending_remote_op,
    queue_pending_remote_op_for_local_commit, queued_remote_error,
    remote_mutation_allows_local_commit, RemoteMutationOutcome,
};

/// Data resolved from the local DB that the async writeback branches need.
enum WritebackInfo {
    Gmail {
        msg: Message,
    },
    Outlook {
        msg: Message,
    },
    Imap {
        msg: Message,
        folder_remote_id: String,
        imap_config: ImapConfig,
    },
    None,
}

#[tauri::command]
pub async fn update_message_flags(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    is_read: Option<bool>,
    is_starred: Option<bool>,
    // Commit the new flags locally before the provider acknowledges them. Set
    // when the change *is* the user's action rather than a preference they are
    // configuring: opening a message marks it read, and waiting for an IMAP
    // `SELECT` + `STORE` round trip during that transition is the difference
    // between the unread dot clearing now and clearing seconds later.
    optimistic: Option<bool>,
) -> std::result::Result<(), PebbleError> {
    // 1. Resolve DB state off the Tokio runtime before attempting remote writeback.
    let store = state.store.clone();
    let crypto = state.crypto.clone();
    let msg_id = message_id.clone();

    let writeback_info =
        tokio::task::spawn_blocking(move || -> std::result::Result<WritebackInfo, PebbleError> {
            let msg = match store.get_message(&msg_id)? {
                Some(m) => m,
                None => return Ok(WritebackInfo::None),
            };

            let provider_type = store
                .get_account(&msg.account_id)?
                .map(|account| account.provider);

            match provider_type {
                Some(ProviderType::Gmail) => Ok(WritebackInfo::Gmail { msg }),
                Some(ProviderType::Outlook) => Ok(WritebackInfo::Outlook { msg }),
                Some(ProviderType::Pop3) => Ok(WritebackInfo::None),
                Some(ProviderType::Imap) | None => {
                    // For IMAP we also need the folder's remote_id and the IMAP
                    // config; both require store / crypto access, so resolve them
                    // here inside the blocking task.
                    let folder_ids = store.get_message_folder_ids(&msg_id)?;
                    let folders = store.list_folders(&msg.account_id)?;
                    let folder = folder_ids
                        .iter()
                        .find_map(|fid| folders.iter().find(|f| &f.id == fid))
                        .cloned();

                    // Missing config here means the account has no IMAP writeback
                    // target; degrade gracefully to `None` rather than failing the
                    // whole flag update, which is local-only-valid in that case.
                    let imap_config: Option<ImapConfig> =
                        load_imap_config(&store, &crypto, &msg.account_id).ok();

                    match (folder, imap_config) {
                        (Some(f), Some(cfg)) => Ok(WritebackInfo::Imap {
                            msg,
                            folder_remote_id: f.remote_id.clone(),
                            imap_config: cfg,
                        }),
                        _ => Ok(WritebackInfo::None),
                    }
                }
            }
        })
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))??;

    // 2. Optimistic path. The local flag is the user's action, so it is written
    //    now and the provider is told afterwards; the badge is refreshed from
    //    the database, which is why it clears immediately too.
    if optimistic.unwrap_or(false) {
        commit_local_flags(&state, &message_id, is_read, is_starred).await?;
        if is_read.is_some() {
            badge::request_refresh(&app);
        }

        let app = app.clone();
        let message_id = message_id.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            if let Err(error) =
                apply_remote_writeback(&state, writeback_info, is_read, is_starred).await
            {
                tracing::warn!("Deferred flag writeback failed for {message_id}: {error}");
            }
        });
        return Ok(());
    }

    // 3. Provider-specific remote writeback. Local flags are committed only
    //    after remote ack or when there is no remote target.
    let outcome = apply_remote_writeback(&state, writeback_info, is_read, is_starred).await?;

    if !remote_mutation_allows_local_commit(outcome) {
        return Err(PebbleError::Network(
            "Remote flag update was not applied".to_string(),
        ));
    }

    commit_local_flags(&state, &message_id, is_read, is_starred).await?;

    if is_read.is_some() {
        badge::request_refresh(&app);
    }

    Ok(())
}

/// Push one flag change to the account's provider, queueing a retry when it
/// cannot be delivered.
async fn apply_remote_writeback(
    state: &AppState,
    writeback_info: WritebackInfo,
    is_read: Option<bool>,
    is_starred: Option<bool>,
) -> std::result::Result<RemoteMutationOutcome, PebbleError> {
    let outcome = match writeback_info {
        WritebackInfo::Gmail { msg } => {
            let mut add = Vec::new();
            let mut remove = Vec::new();
            if let Some(read) = is_read {
                if read {
                    remove.push("UNREAD".to_string());
                } else {
                    add.push("UNREAD".to_string());
                }
            }
            if let Some(starred) = is_starred {
                if starred {
                    add.push("STARRED".to_string());
                } else {
                    remove.push("STARRED".to_string());
                }
            }

            if !add.is_empty() || !remove.is_empty() {
                let remote_id = msg.remote_id.clone();
                match connect_gmail(state, &msg.account_id).await {
                    Ok(provider) => match provider.modify_labels(&remote_id, &add, &remove).await {
                        Ok(()) => RemoteMutationOutcome::Applied,
                        Err(e) => {
                            let error = e.to_string();
                            let outcome = queue_pending_remote_op(
                                state,
                                &msg,
                                "update_flags",
                                json!({
                                    "is_read": is_read,
                                    "is_starred": is_starred,
                                    "add_labels": add,
                                    "remove_labels": remove,
                                }),
                                &error,
                            )?;
                            if !remote_mutation_allows_local_commit(outcome) {
                                return Err(queued_remote_error("update_flags", &error));
                            }
                            outcome
                        }
                    },
                    Err(e) => {
                        let error = e.to_string();
                        let outcome = queue_pending_remote_op_for_local_commit(
                            state,
                            &msg,
                            "update_flags",
                            json!({
                                "is_read": is_read,
                                "is_starred": is_starred,
                                "add_labels": add,
                                "remove_labels": remove,
                            }),
                            &error,
                        )?;
                        if !remote_mutation_allows_local_commit(outcome) {
                            return Err(queued_remote_error("update_flags", &error));
                        }
                        outcome
                    }
                }
            } else {
                RemoteMutationOutcome::LocalOnly
            }
        }
        WritebackInfo::Outlook { msg } => {
            let remote_id = msg.remote_id.clone();
            match connect_outlook(state, &msg.account_id).await {
                Ok(provider) => {
                    if let Some(read) = is_read {
                        if let Err(e) = provider.update_read_status(&remote_id, read).await {
                            let error = e.to_string();
                            let outcome = queue_pending_remote_op(
                                state,
                                &msg,
                                "update_flags",
                                json!({
                                    "is_read": is_read,
                                    "is_starred": is_starred,
                                }),
                                &error,
                            )?;
                            if !remote_mutation_allows_local_commit(outcome) {
                                return Err(queued_remote_error("update_flags", &error));
                            }
                            return Err(PebbleError::Network(
                                "Remote flag update was not applied".to_string(),
                            ));
                        }
                    }
                    if let Some(starred) = is_starred {
                        if let Err(e) = provider.update_flag_status(&remote_id, starred).await {
                            let error = e.to_string();
                            let outcome = queue_pending_remote_op(
                                state,
                                &msg,
                                "update_flags",
                                json!({
                                    "is_read": is_read,
                                    "is_starred": is_starred,
                                }),
                                &error,
                            )?;
                            if !remote_mutation_allows_local_commit(outcome) {
                                return Err(queued_remote_error("update_flags", &error));
                            }
                            return Err(PebbleError::Network(
                                "Remote flag update was not applied".to_string(),
                            ));
                        }
                    }
                    RemoteMutationOutcome::Applied
                }
                Err(e) => {
                    let error = e.to_string();
                    let outcome = queue_pending_remote_op_for_local_commit(
                        state,
                        &msg,
                        "update_flags",
                        json!({
                            "is_read": is_read,
                            "is_starred": is_starred,
                        }),
                        &error,
                    )?;
                    if !remote_mutation_allows_local_commit(outcome) {
                        return Err(queued_remote_error("update_flags", &error));
                    }
                    outcome
                }
            }
        }
        WritebackInfo::Imap {
            msg,
            folder_remote_id,
            imap_config,
        } => {
            if let Ok(uid) = msg.remote_id.parse::<u32>() {
                let provider = ImapProvider::new(imap_config);
                match provider.connect().await {
                    Ok(()) => {
                        let result = provider
                            .set_flags(&folder_remote_id, uid, is_read, is_starred)
                            .await;
                        let _ = provider.disconnect().await;
                        match result {
                            Ok(()) => RemoteMutationOutcome::Applied,
                            Err(e) => {
                                let error = e.to_string();
                                let outcome = queue_pending_remote_op(
                                    state,
                                    &msg,
                                    "update_flags",
                                    json!({
                                        "folder_remote_id": folder_remote_id,
                                        "is_read": is_read,
                                        "is_starred": is_starred,
                                    }),
                                    &error,
                                )?;
                                if !remote_mutation_allows_local_commit(outcome) {
                                    return Err(queued_remote_error("update_flags", &error));
                                }
                                outcome
                            }
                        }
                    }
                    Err(e) => {
                        let error = e.to_string();
                        let outcome = queue_pending_remote_op_for_local_commit(
                            state,
                            &msg,
                            "update_flags",
                            json!({
                                "folder_remote_id": folder_remote_id,
                                "is_read": is_read,
                                "is_starred": is_starred,
                            }),
                            &error,
                        )?;
                        if !remote_mutation_allows_local_commit(outcome) {
                            return Err(queued_remote_error("update_flags", &error));
                        }
                        outcome
                    }
                }
            } else {
                let error = format!("Invalid IMAP UID: {}", msg.remote_id);
                let outcome = queue_pending_remote_op(
                    state,
                    &msg,
                    "update_flags",
                    json!({
                        "folder_remote_id": folder_remote_id,
                        "is_read": is_read,
                        "is_starred": is_starred,
                    }),
                    &error,
                )?;
                if !remote_mutation_allows_local_commit(outcome) {
                    return Err(queued_remote_error("update_flags", &error));
                }
                outcome
            }
        }
        WritebackInfo::None => RemoteMutationOutcome::LocalOnly,
    };

    Ok(outcome)
}

/// Write the flags into the local database.
async fn commit_local_flags(
    state: &AppState,
    message_id: &str,
    is_read: Option<bool>,
    is_starred: Option<bool>,
) -> std::result::Result<(), PebbleError> {
    let store = state.store.clone();
    let message_id = message_id.to_string();
    tokio::task::spawn_blocking(move || {
        store.update_message_flags(&message_id, is_read, is_starred)
    })
    .await
    .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))??;
    Ok(())
}
