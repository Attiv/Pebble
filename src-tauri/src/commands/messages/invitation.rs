use crate::state::AppState;
use pebble_core::{Message, PebbleError, ProviderType};
use pebble_mail::invitation::{inspect_meeting_invitation, InvitationDiagnostic};
use tauri::State;

#[tauri::command]
pub async fn check_meeting_invitation(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<InvitationDiagnostic, PebbleError> {
    let (message, raw) = read_original_imap_message(&state, &message_id).await?;
    tokio::task::spawn_blocking(move || {
        inspect_meeting_invitation(&raw, message.message_id_header.as_deref())
    })
    .await
    .map_err(|error| PebbleError::Internal(format!("Invitation check task failed: {error}")))?
}

pub(in crate::commands) async fn read_original_imap_message(
    state: &AppState,
    message_id: &str,
) -> Result<(Message, Vec<u8>), PebbleError> {
    let message = state
        .store
        .get_message(message_id)?
        .ok_or_else(|| PebbleError::Validation("Message not found".into()))?;
    let account = state
        .store
        .get_account(&message.account_id)?
        .ok_or_else(|| PebbleError::Validation("Account not found".into()))?;
    if account.provider != ProviderType::Imap {
        return Err(PebbleError::Validation(
            "Meeting invitation checks currently support IMAP accounts only".into(),
        ));
    }
    let uid = super::provider_dispatch::parse_imap_uid(&message.remote_id)?;
    let folder = super::find_message_folder(state, message_id, &message.account_id)?;
    if folder.remote_id.starts_with("__local_") {
        return Err(PebbleError::Validation(
            "This message has no remote IMAP mailbox".into(),
        ));
    }
    let cursor = state
        .store
        .get_folder_sync_state(&message.account_id, &folder.id)?
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let uid_validity = cursor
        .as_ref()
        .and_then(|cursor| cursor.get("uidvalidity"))
        .and_then(|value| value.as_u64());

    let provider = super::connect_imap(state, &message.account_id).await?;
    let result = provider
        .fetch_message_raw(&folder.remote_id, uid, uid_validity)
        .await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), provider.disconnect()).await;
    Ok((message, result?))
}
