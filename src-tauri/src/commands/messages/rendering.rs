use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use pebble_core::{Attachment, Message, PebbleError, PrivacyMode, RenderedHtml, TrustType};
use pebble_privacy::PrivacyGuard;
use pebble_store::Store;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn get_rendered_html(
    state: State<'_, AppState>,
    message_id: String,
    privacy_mode: PrivacyMode,
) -> std::result::Result<RenderedHtml, PebbleError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || {
        let message = store
            .get_message(&message_id)?
            .ok_or_else(|| PebbleError::Internal(format!("Message not found: {message_id}")))?;

        let effective_mode = resolve_privacy_mode(&store, &message, privacy_mode)?;
        render_message_html(&store, &message, &effective_mode)
    })
    .await
    .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn get_message_with_html(
    state: State<'_, AppState>,
    message_id: String,
    privacy_mode: PrivacyMode,
) -> std::result::Result<Option<(Message, RenderedHtml)>, PebbleError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || {
        let message = match store.get_message(&message_id)? {
            Some(m) => m,
            None => return Ok(None),
        };

        let effective_mode = resolve_privacy_mode(&store, &message, privacy_mode)?;
        let rendered = render_message_html(&store, &message, &effective_mode)?;
        Ok(Some((message, rendered)))
    })
    .await
    .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn is_trusted_sender(
    state: State<'_, AppState>,
    account_id: String,
    email: String,
) -> std::result::Result<bool, PebbleError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || Ok(store.is_trusted_sender(&account_id, &email)?.is_some()))
        .await
        .map_err(|e| PebbleError::Internal(format!("Task join error: {e}")))?
}

fn render_message_html(
    store: &Store,
    message: &Message,
    privacy_mode: &PrivacyMode,
) -> std::result::Result<RenderedHtml, PebbleError> {
    let attachments = store.list_attachments_by_message(&message.id)?;
    let html = inline_cid_images(&message.body_html_raw, &attachments);
    let guard = PrivacyGuard::new();
    Ok(guard.render_message_html(&html, &message.body_text, privacy_mode))
}

fn inline_cid_images(html: &str, attachments: &[Attachment]) -> String {
    let mut images = HashMap::new();
    for attachment in attachments {
        let Some(content_id) = attachment
            .content_id
            .as_deref()
            .and_then(normalize_content_id)
        else {
            continue;
        };
        let Some(mime_type) = safe_raster_mime_type(&attachment.mime_type) else {
            continue;
        };
        let Some(local_path) = attachment.local_path.as_deref() else {
            continue;
        };
        let Ok(bytes) = std::fs::read(local_path) else {
            continue;
        };
        images.insert(
            content_id,
            format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        );
    }

    if images.is_empty() {
        return html.to_string();
    }

    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("img[src]", move |element| {
                let Some(source) = element.get_attribute("src") else {
                    return Ok(());
                };
                let Some(content_id) = normalize_cid_reference(&source) else {
                    return Ok(());
                };
                if let Some(data_url) = images.get(&content_id) {
                    element.set_attribute("src", data_url)?;
                }
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .unwrap_or_else(|_| html.to_string())
}

fn safe_raster_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

fn normalize_cid_reference(value: &str) -> Option<String> {
    let value = value.trim();
    let prefix = value.get(..4)?;
    if !prefix.eq_ignore_ascii_case("cid:") {
        return None;
    }
    normalize_content_id(&percent_decode(&value[4..])?)
}

fn normalize_content_id(value: &str) -> Option<String> {
    let value = value.trim();
    let value = value
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
        .unwrap_or(value)
        .trim();
    (!value.is_empty()).then(|| value.to_ascii_lowercase())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push((hex_value(high)? << 4) | hex_value(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

/// Fold the sender's persisted trust level into the caller's requested mode.
///
/// Two invariants hold here:
///
/// 1. A sender override must name the message's own sender *and* be backed by a
///    persisted `trusted_senders` row. A caller cannot grant itself trust.
/// 2. The persisted level caps the request. It can lift a sender above the
///    default (which is what makes `trusted_senders` useful at all), but the
///    caller can never ask for more than what is stored: `Images` resolves to
///    `LoadOnce` (remote images load, trackers stay stripped) and only `All`
///    resolves to `TrustedSender` (trackers load too).
fn resolve_privacy_mode(
    store: &Store,
    message: &Message,
    privacy_mode: PrivacyMode,
) -> std::result::Result<PrivacyMode, PebbleError> {
    let persisted = store.is_trusted_sender(&message.account_id, &message.from_address)?;

    let trust_to_mode = |trust: TrustType| match trust {
        TrustType::All => PrivacyMode::TrustedSender(message.from_address.clone()),
        TrustType::Images => PrivacyMode::LoadOnce,
    };

    match privacy_mode {
        // Explicit per-message override coming from the privacy banner.
        PrivacyMode::TrustedSender(sender)
            if sender.eq_ignore_ascii_case(message.from_address.trim()) =>
        {
            Ok(match persisted {
                Some(trust) => trust_to_mode(trust),
                None => PrivacyMode::Strict,
            })
        }
        // Override naming a different sender: fall back to the strictest mode
        // rather than letting the override travel to another message.
        PrivacyMode::TrustedSender(_) => Ok(PrivacyMode::Strict),

        // Regular modes: persisted trust still lifts the sender above the
        // requested mode; the request itself is never weakened otherwise.
        PrivacyMode::Strict | PrivacyMode::LoadOnce => match persisted {
            Some(trust) => Ok(trust_to_mode(trust)),
            None => Ok(privacy_mode),
        },
        PrivacyMode::Off => Ok(PrivacyMode::Off),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pebble_core::{
        new_id, now_timestamp, Account, EmailAddress, Folder, FolderRole, FolderType, Message,
        ProviderType, TrustType, TrustedSender,
    };

    fn make_account(id: &str) -> Account {
        let now = now_timestamp();
        Account {
            account_label: None,
            provider_display_name: None,
            id: id.to_string(),
            email: "me@example.com".to_string(),
            display_name: "Me".to_string(),
            color: None,
            provider: ProviderType::Imap,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_message(account_id: &str, from_address: &str) -> Message {
        let now = now_timestamp();
        Message {
            id: new_id(),
            account_id: account_id.to_string(),
            remote_id: "remote-1".to_string(),
            message_id_header: None,
            in_reply_to: None,
            references_header: None,
            thread_id: Some("thread-1".to_string()),
            subject: "Subject".to_string(),
            snippet: "Snippet".to_string(),
            from_address: from_address.to_string(),
            from_name: "Trusted".to_string(),
            to_list: vec![EmailAddress {
                name: None,
                address: "me@example.com".to_string(),
            }],
            cc_list: vec![],
            bcc_list: vec![],
            body_text: "Body".to_string(),
            body_html_raw: "<p>Body</p>".to_string(),
            has_attachments: false,
            is_read: false,
            is_starred: false,
            is_draft: false,
            date: now,
            remote_version: None,
            is_deleted: false,
            deleted_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn make_folder(account_id: &str) -> Folder {
        Folder {
            id: new_id(),
            account_id: account_id.to_string(),
            remote_id: "INBOX".to_string(),
            name: "Inbox".to_string(),
            role: Some(FolderRole::Inbox),
            folder_type: FolderType::Folder,
            parent_id: None,
            color: None,
            is_system: true,
            sort_order: 0,
        }
    }

    fn store_with_trusted_sender(trust_type: TrustType) -> (Store, Message) {
        let store = Store::open_in_memory().unwrap();
        let account = make_account("account-1");
        store.insert_account(&account).unwrap();
        let folder = make_folder(&account.id);
        store.insert_folder(&folder).unwrap();
        let message = make_message(&account.id, "trusted@example.com");
        store.insert_message(&message, &[folder.id]).unwrap();
        store
            .trust_sender(&TrustedSender {
                account_id: account.id,
                email: "trusted@example.com".to_string(),
                trust_type,
                created_at: now_timestamp(),
            })
            .unwrap();
        (store, message)
    }

    #[test]
    fn fully_trusted_sender_lifts_tracker_blocking_in_relaxed_mode() {
        let (store, message) = store_with_trusted_sender(TrustType::All);

        let mode = resolve_privacy_mode(&store, &message, PrivacyMode::LoadOnce).unwrap();

        assert!(matches!(mode, PrivacyMode::TrustedSender(_)));
    }

    #[test]
    fn images_only_trust_loads_images_without_lifting_tracker_blocking() {
        let (store, message) = store_with_trusted_sender(TrustType::Images);

        let mode = resolve_privacy_mode(&store, &message, PrivacyMode::LoadOnce).unwrap();

        assert!(matches!(mode, PrivacyMode::LoadOnce));
    }

    #[test]
    fn images_only_trust_also_helps_in_strict_mode() {
        let (store, message) = store_with_trusted_sender(TrustType::Images);

        let mode = resolve_privacy_mode(&store, &message, PrivacyMode::Strict).unwrap();

        assert!(matches!(mode, PrivacyMode::LoadOnce));
    }

    #[test]
    fn untrusted_sender_keeps_the_requested_mode() {
        let store = Store::open_in_memory().unwrap();
        let account = make_account("account-1");
        store.insert_account(&account).unwrap();
        let message = make_message(&account.id, "stranger@example.com");

        let mode = resolve_privacy_mode(&store, &message, PrivacyMode::Strict).unwrap();

        assert!(matches!(mode, PrivacyMode::Strict));
    }

    #[test]
    fn sender_override_with_persistent_all_trust_reaches_full_trust() {
        let (store, message) = store_with_trusted_sender(TrustType::All);

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustedSender("trusted@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::TrustedSender(_)));
    }

    #[test]
    fn sender_override_cannot_be_reused_for_a_different_message_sender() {
        let (store, mut message) = store_with_trusted_sender(TrustType::All);
        message.from_address = "other@example.com".to_string();

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustedSender("trusted@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::Strict));
    }

    #[test]
    fn matching_sender_override_is_rejected_without_persisted_trust() {
        let store = Store::open_in_memory().unwrap();
        let account = make_account("account-1");
        store.insert_account(&account).unwrap();
        let message = make_message(&account.id, "sender@example.com");

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustedSender("sender@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::Strict));
    }

    #[test]
    fn images_only_trust_cannot_be_escalated_by_sender_override() {
        let (store, message) = store_with_trusted_sender(TrustType::Images);

        let mode = resolve_privacy_mode(
            &store,
            &message,
            PrivacyMode::TrustedSender("trusted@example.com".to_string()),
        )
        .unwrap();

        assert!(matches!(mode, PrivacyMode::LoadOnce));
    }

    fn inline_attachment(path: &str, mime_type: &str, content_id: &str) -> Attachment {
        Attachment {
            id: new_id(),
            message_id: "message-1".to_string(),
            filename: "image.png".to_string(),
            mime_type: mime_type.to_string(),
            size: 3,
            local_path: Some(path.to_string()),
            content_id: Some(content_id.to_string()),
            is_inline: true,
        }
    }

    #[test]
    fn cid_image_is_replaced_with_local_data_url() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), [1, 2, 3]).unwrap();
        let attachment = inline_attachment(
            file.path().to_str().unwrap(),
            "IMAGE/PNG; name=image.png",
            "<Image 001@example.com>",
        );

        let html = inline_cid_images(
            r#"<p><img alt="inline" src="CID:%49mage%20001@example.com"></p>"#,
            &[attachment],
        );

        assert!(html.contains(r#"src="data:image/png;base64,AQID""#));
        assert!(!html.contains("CID:"));
    }

    #[test]
    fn missing_cid_attachment_is_left_unchanged() {
        let source = r#"<img src="cid:missing@example.com">"#;

        assert_eq!(inline_cid_images(source, &[]), source);
    }

    #[test]
    fn unsafe_inline_mime_type_is_not_embedded() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"<svg></svg>").unwrap();
        let attachment = inline_attachment(
            file.path().to_str().unwrap(),
            "image/svg+xml",
            "vector@example.com",
        );
        let source = r#"<img src="cid:vector@example.com">"#;

        assert_eq!(inline_cid_images(source, &[attachment]), source);
    }

    #[test]
    fn cid_links_are_not_rewritten() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), [1, 2, 3]).unwrap();
        let attachment = inline_attachment(
            file.path().to_str().unwrap(),
            "image/png",
            "image@example.com",
        );
        let source = r#"<a href="cid:image@example.com">Open</a>"#;

        assert_eq!(inline_cid_images(source, &[attachment]), source);
    }
}
