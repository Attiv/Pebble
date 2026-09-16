use crate::state::AppState;
use pebble_core::traits::SearchHit;
use pebble_core::PebbleError;
use tauri::State;

#[tauri::command]
pub async fn search_messages(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    account_id: Option<String>,
) -> std::result::Result<Vec<SearchHit>, PebbleError> {
    let limit = limit.unwrap_or(50);
    let search = state.search.clone();
    // `None` means the caller explicitly asked for the combined "all accounts"
    // view; anything else must stay inside that mailbox.
    tokio::task::spawn_blocking(move || search.search(&query, limit, account_id.as_deref()))
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}
