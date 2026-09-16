use crate::state::AppState;
use pebble_core::PebbleError;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn get_folder_unread_counts(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<HashMap<String, u32>, PebbleError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || store.get_folder_unread_counts(&account_id))
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

/// Unread mail per account, keyed by account id and skipping accounts with
/// nothing unread.
///
/// This is the same scope the app icon badge counts (unread, not deleted, and
/// not filed exclusively under drafts, trash or spam), so the sidebar's
/// per-mailbox "mark all as read" affordances agree with the badge.
#[tauri::command]
pub async fn get_account_unread_counts(
    state: State<'_, AppState>,
) -> std::result::Result<HashMap<String, u32>, PebbleError> {
    let store = state.store.clone();
    let counts = tokio::task::spawn_blocking(move || store.get_unread_counts_by_account())
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))??;
    Ok(counts.into_iter().collect())
}
