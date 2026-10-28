use crate::state::AppState;
use pebble_core::{now_timestamp, PebbleError, TrustType, TrustedSender};
use tauri::State;

/// Trust a sender, for every mailbox.
///
/// `account_id` records which mailbox the reader was in when they made the
/// decision; it is not part of how the decision is read back, because a
/// tracking pixel costs the same whichever of the reader's addresses received
/// it.
#[tauri::command]
pub async fn trust_sender(
    state: State<'_, AppState>,
    account_id: String,
    email: String,
    trust_type: TrustType,
) -> std::result::Result<(), PebbleError> {
    let sender = TrustedSender {
        account_id,
        email,
        trust_type,
        created_at: now_timestamp(),
    };
    state.store.trust_sender(&sender)
}

#[tauri::command]
pub async fn list_trusted_senders(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<TrustedSender>, PebbleError> {
    state.store.list_trusted_senders()
}

#[tauri::command]
pub async fn remove_trusted_sender(
    state: State<'_, AppState>,
    email: String,
) -> std::result::Result<(), PebbleError> {
    state.store.remove_trusted_sender(&email)
}
