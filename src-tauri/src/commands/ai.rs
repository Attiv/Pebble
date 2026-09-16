use super::network::get_global_proxy_raw;
use crate::commands::encrypted_store::{ACTIVE_AI_CONFIG_ID, AI_CONFIG_PURPOSE};
use crate::commands::translate::{
    decrypt_config, hex_decode, hex_encode, validate_outbound_url, validate_provider_config,
};
use crate::state::AppState;
use pebble_ai::types::{AiAction, AiLength, AiProviderConfig, AiResult, AiTone};
use pebble_ai::AiService;
use pebble_core::{now_timestamp, AiConfig, PebbleError, Result};
use pebble_crypto::CryptoService;
use pebble_store::Store;
use pebble_translate::types::TranslateProviderConfig;
use pebble_translate::TranslateService;
use tauri::State;

/// Long emails would blow past sane prompt budgets. Summarisation only needs
/// the gist, so truncate on a character boundary rather than a byte one.
const MAX_SUMMARY_CHARS: usize = 12_000;
/// Bounds for the compose actions so a runaway selection cannot be sent.
const MAX_COMPOSE_CHARS: usize = 20_000;

/// Decrypt the config field of an AiConfig. Legacy plaintext JSON is migrated
/// to the encrypted form in place — the same lazy path the translate module
/// uses, but under [`AI_CONFIG_PURPOSE`] so the two secrets never interchange.
fn decrypt_ai_config_with_store(
    crypto: &CryptoService,
    store: &Store,
    stored: &str,
) -> Result<String> {
    if serde_json::from_str::<serde_json::Value>(stored).is_ok() {
        let encrypted = encrypt_ai_config_with_crypto(crypto, stored)?;
        store.compare_exchange_ai_config_blob(stored, &encrypted)?;
        return Ok(stored.to_string());
    }

    let bytes = hex_decode(stored)?;
    let needs_migration = CryptoService::ciphertext_needs_migration(&bytes);
    let decrypted = crypto.decrypt_for(AI_CONFIG_PURPOSE, ACTIVE_AI_CONFIG_ID, &bytes)?;
    let plaintext = String::from_utf8(decrypted)
        .map_err(|e| PebbleError::Ai(format!("Invalid UTF-8 in decrypted AI config: {e}")))?;
    if needs_migration {
        let encrypted = encrypt_ai_config_with_crypto(crypto, &plaintext)?;
        store.compare_exchange_ai_config_blob(stored, &encrypted)?;
    }
    Ok(plaintext)
}

fn encrypt_ai_config_with_crypto(crypto: &CryptoService, plaintext: &str) -> Result<String> {
    let encrypted =
        crypto.encrypt_for(AI_CONFIG_PURPOSE, ACTIVE_AI_CONFIG_ID, plaintext.as_bytes())?;
    Ok(hex_encode(&encrypted))
}

/// The configured provider, or `None` when AI is unset or switched off.
///
/// Every AI command funnels through here so "disabled" and "unconfigured"
/// behave identically: the feature reports itself as unavailable instead of
/// firing a request at a half-filled config.
fn load_enabled_ai_provider(state: &AppState) -> Result<Option<AiProviderConfig>> {
    let Some(stored) = state.store.get_ai_config()? else {
        return Ok(None);
    };
    if !stored.is_enabled {
        return Ok(None);
    }
    let decrypted = decrypt_ai_config_with_store(&state.crypto, &state.store, &stored.config)?;
    let parsed: AiProviderConfig = serde_json::from_str(&decrypted)
        .map_err(|e| PebbleError::Ai(format!("Invalid AI config: {e}")))?;
    Ok(Some(parsed))
}

fn require_ai_provider(state: &AppState) -> Result<AiProviderConfig> {
    load_enabled_ai_provider(state)?.ok_or_else(|| {
        PebbleError::Ai("No AI service configured. Set one up in Settings › AI.".to_string())
    })
}

fn validate_ai_provider_config(config: &AiProviderConfig) -> Result<()> {
    validate_outbound_url(config.endpoint())?;
    if let AiProviderConfig::Generic {
        prompt_param,
        result_path,
        ..
    } = config
    {
        if prompt_param.trim().is_empty() {
            return Err(PebbleError::Validation(
                "The prompt field name must not be empty".into(),
            ));
        }
        if result_path.trim().is_empty() {
            return Err(PebbleError::Validation(
                "The result path must not be empty".into(),
            ));
        }
    }
    Ok(())
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(limit).collect();
    truncated.push('…');
    truncated
}

/// Prefer the stored plain text; fall back to stripping the HTML body.
fn message_content(body_text: &str, body_html_raw: &str) -> String {
    let text = body_text.trim();
    if !text.is_empty() {
        return text.to_string();
    }
    pebble_core::strip_html_for_snippet(body_html_raw)
        .trim()
        .to_string()
}

fn require_text(text: &str, action: AiAction) -> Result<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(PebbleError::Ai(format!(
            "Nothing to send to the AI service for {action:?}: the input is empty"
        )));
    }
    Ok(truncate_chars(trimmed, MAX_COMPOSE_CHARS))
}

// ─── Configuration ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ai_get_config(state: State<'_, AppState>) -> Result<Option<AiConfig>> {
    match state.store.get_ai_config()? {
        Some(mut config) => {
            config.config =
                decrypt_ai_config_with_store(&state.crypto, &state.store, &config.config)?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn ai_save_config(
    state: State<'_, AppState>,
    provider_type: String,
    config: String,
    is_enabled: bool,
) -> Result<()> {
    let provider_config: AiProviderConfig = serde_json::from_str(&config)
        .map_err(|e| PebbleError::Ai(format!("Invalid config: {e}")))?;
    validate_ai_provider_config(&provider_config)?;

    let encrypted = encrypt_ai_config_with_crypto(&state.crypto, &config)?;
    let now = now_timestamp();
    state.store.save_ai_config(&AiConfig {
        id: ACTIVE_AI_CONFIG_ID.to_string(),
        provider_type,
        config: encrypted,
        is_enabled,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub async fn ai_delete_config(state: State<'_, AppState>) -> Result<()> {
    state.store.delete_ai_config()
}

#[tauri::command]
pub async fn ai_test_connection(state: State<'_, AppState>, config: String) -> Result<String> {
    let provider_config: AiProviderConfig = serde_json::from_str(&config)
        .map_err(|e| PebbleError::Ai(format!("Invalid config: {e}")))?;
    validate_ai_provider_config(&provider_config)?;

    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;
    let reply = AiService::complete(
        &provider_config,
        proxy.as_ref(),
        "You are a connectivity probe. Reply with the single word: ok",
        "ok?",
    )
    .await?;
    Ok(reply.trim().to_string())
}

// ─── Model discovery ─────────────────────────────────────────────────────────

/// The endpoint and key a model listing needs, or the reason there is none.
///
/// Split out of the command so the "this provider cannot be listed" rule is
/// testable without standing up an `AppState`.
fn model_list_target(config: &AiProviderConfig) -> Result<(&str, &str)> {
    match config {
        AiProviderConfig::OpenAiCompatible {
            endpoint, api_key, ..
        } => Ok((endpoint, api_key)),
        AiProviderConfig::Generic { .. } => Err(PebbleError::Ai(
            "This provider has no standard model list endpoint. Type the model name instead."
                .to_string(),
        )),
    }
}

/// The models the endpoint offers, for the settings dropdown.
///
/// Takes the *unsaved* config so the list can be pulled while the endpoint or
/// key is still being edited; waiting for a save would mean the dropdown never
/// matches what is on screen.
#[tauri::command]
pub async fn ai_list_models(state: State<'_, AppState>, config: String) -> Result<Vec<String>> {
    let provider_config: AiProviderConfig = serde_json::from_str(&config)
        .map_err(|e| PebbleError::Ai(format!("Invalid config: {e}")))?;

    let (endpoint, api_key) = model_list_target(&provider_config)?;
    validate_outbound_url(endpoint)?;

    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;
    let client = AiService::http_client_with_proxy(proxy.as_ref())?;
    pebble_translate::models::fetch_model_ids(&client, endpoint, Some(api_key))
        .await
        .map_err(PebbleError::Ai)
}

// ─── Message detail: summarise ───────────────────────────────────────────────

#[tauri::command]
pub async fn ai_summarize_message(
    state: State<'_, AppState>,
    message_id: String,
    target_lang: String,
) -> Result<AiResult> {
    let provider = require_ai_provider(&state)?;

    let message = state
        .store
        .get_message(&message_id)?
        .ok_or_else(|| PebbleError::Ai(format!("Message {message_id} was not found")))?;

    let content = message_content(&message.body_text, &message.body_html_raw);
    if content.trim().is_empty() {
        return Err(PebbleError::Ai(
            "This message has no text content to summarise".to_string(),
        ));
    }
    let content = truncate_chars(&content, MAX_SUMMARY_CHARS);

    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;
    let summary = AiService::summarize(&provider, proxy.as_ref(), &content, &target_lang).await?;

    Ok(AiResult {
        text: summary,
        engine: "ai".to_string(),
    })
}

// ─── Compose: polish / proofread / translate / help write ────────────────────

#[tauri::command]
pub async fn ai_polish(state: State<'_, AppState>, text: String, tone: AiTone) -> Result<AiResult> {
    let provider = require_ai_provider(&state)?;
    let text = require_text(&text, AiAction::Polish)?;

    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;
    let polished = AiService::polish(&provider, proxy.as_ref(), &text, tone).await?;
    Ok(AiResult {
        text: polished,
        engine: "ai".to_string(),
    })
}

#[tauri::command]
pub async fn ai_proofread(state: State<'_, AppState>, text: String) -> Result<AiResult> {
    let provider = require_ai_provider(&state)?;
    let text = require_text(&text, AiAction::Proofread)?;

    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;
    let corrected = AiService::proofread(&provider, proxy.as_ref(), &text).await?;
    Ok(AiResult {
        text: corrected,
        engine: "ai".to_string(),
    })
}

/// Translate a draft.
///
/// AI first: the configured AI service produces the translation. Only when the
/// AI module is unset or switched off does this fall back to the translate
/// engine, and the returned `engine` field tells the UI which one answered.
/// A *failing* AI call is reported rather than silently downgraded, so a
/// mis-typed key surfaces instead of quietly changing translation quality.
#[tauri::command]
pub async fn ai_translate(
    state: State<'_, AppState>,
    text: String,
    from_lang: String,
    to_lang: String,
) -> Result<AiResult> {
    let text = require_text(&text, AiAction::Translate)?;
    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;

    if let Some(provider) = load_enabled_ai_provider(&state)? {
        let translated =
            AiService::translate(&provider, proxy.as_ref(), &text, &from_lang, &to_lang).await?;
        return Ok(AiResult {
            text: translated,
            engine: "ai".to_string(),
        });
    }

    let Some(stored) = state.store.get_translate_config()?.filter(|c| c.is_enabled) else {
        return Err(PebbleError::Ai(
            "No AI service is configured and no translation engine is enabled. Set either up in Settings."
                .to_string(),
        ));
    };

    let provider_config: TranslateProviderConfig =
        serde_json::from_str(&decrypt_config(&state, &stored.config)?)
            .map_err(|e| PebbleError::Translate(format!("Invalid config: {e}")))?;
    validate_provider_config(&provider_config)?;

    let result = TranslateService::translate_with_proxy(
        &provider_config,
        proxy.as_ref(),
        &text,
        &from_lang,
        &to_lang,
    )
    .await?;

    Ok(AiResult {
        text: result.translated,
        engine: "translate".to_string(),
    })
}

#[tauri::command]
pub async fn ai_help_write(
    state: State<'_, AppState>,
    intent: String,
    tone: AiTone,
    length: AiLength,
    target_lang: String,
    context: Option<String>,
) -> Result<AiResult> {
    let provider = require_ai_provider(&state)?;
    let intent = require_text(&intent, AiAction::HelpWrite)?;
    let context = context
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(|c| truncate_chars(c, MAX_COMPOSE_CHARS));

    let proxy = get_global_proxy_raw(&state.crypto, &state.store)?;
    let draft = AiService::help_write(
        &provider,
        proxy.as_ref(),
        &intent,
        tone,
        length,
        &target_lang,
        context.as_deref(),
    )
    .await?;

    Ok(AiResult {
        text: draft,
        engine: "ai".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_keeps_short_text_untouched() {
        assert_eq!(truncate_chars("hello", 10), "hello");
    }

    #[test]
    fn truncate_counts_characters_not_bytes() {
        // 5 Chinese characters = 15 bytes; a byte-based cut would corrupt it.
        let truncated = truncate_chars("一二三四五", 3);
        assert_eq!(truncated, "一二三…");
    }

    #[test]
    fn message_content_prefers_plain_text_and_falls_back_to_html() {
        assert_eq!(message_content("  plain  ", "<p>html</p>"), "plain");
        assert_eq!(message_content("", "<p>html</p>"), "html");
        assert_eq!(message_content("   ", ""), "");
    }

    #[test]
    fn empty_compose_input_is_rejected_before_any_request() {
        let error = require_text("   ", AiAction::Polish).unwrap_err();
        assert!(matches!(error, PebbleError::Ai(_)));
        assert!(error.to_string().contains("empty"));
    }

    #[test]
    fn over_long_compose_input_is_truncated() {
        let text = "a".repeat(MAX_COMPOSE_CHARS + 10);
        let bounded = require_text(&text, AiAction::Proofread).unwrap();
        assert_eq!(bounded.chars().count(), MAX_COMPOSE_CHARS + 1);
    }

    #[test]
    fn provider_config_rejects_plain_http_endpoints() {
        let config = AiProviderConfig::OpenAiCompatible {
            endpoint: "http://api.example.com".into(),
            api_key: "k".into(),
            model: "m".into(),
            mode: pebble_ai::types::LLMMode::Completions,
        };
        assert!(matches!(
            validate_ai_provider_config(&config),
            Err(PebbleError::Validation(_))
        ));
    }

    #[test]
    fn provider_config_allows_https_and_localhost() {
        let https = AiProviderConfig::OpenAiCompatible {
            endpoint: "https://api.example.com".into(),
            api_key: "k".into(),
            model: "m".into(),
            mode: pebble_ai::types::LLMMode::Responses,
        };
        assert!(validate_ai_provider_config(&https).is_ok());

        let local = AiProviderConfig::OpenAiCompatible {
            endpoint: "http://localhost:11434".into(),
            api_key: "k".into(),
            model: "llama".into(),
            mode: pebble_ai::types::LLMMode::Completions,
        };
        assert!(validate_ai_provider_config(&local).is_ok());
    }

    #[test]
    fn model_list_target_accepts_the_openai_variant() {
        let config = AiProviderConfig::OpenAiCompatible {
            endpoint: "https://api.example.com".into(),
            api_key: "secret".into(),
            model: "m".into(),
            mode: pebble_ai::types::LLMMode::Completions,
        };
        assert_eq!(
            model_list_target(&config).unwrap(),
            ("https://api.example.com", "secret")
        );
    }

    /// The Generic variant points at one action URL; there is no standard place
    /// to ask it for a model list, so it must refuse rather than probe blindly.
    #[test]
    fn model_list_target_refuses_the_generic_variant() {
        let config = AiProviderConfig::Generic {
            endpoint: "https://api.example.com/generate".into(),
            api_key: None,
            model: None,
            prompt_param: "prompt".into(),
            result_path: "text".into(),
        };
        let error = model_list_target(&config).unwrap_err();
        assert!(matches!(error, PebbleError::Ai(_)));
        assert!(error.to_string().contains("no standard model list"));
    }

    #[test]
    fn generic_provider_config_requires_both_field_names() {
        let blank_prompt = AiProviderConfig::Generic {
            endpoint: "https://api.example.com".into(),
            api_key: None,
            model: None,
            prompt_param: "  ".into(),
            result_path: "text".into(),
        };
        assert!(validate_ai_provider_config(&blank_prompt).is_err());

        let blank_path = AiProviderConfig::Generic {
            endpoint: "https://api.example.com".into(),
            api_key: None,
            model: None,
            prompt_param: "prompt".into(),
            result_path: String::new(),
        };
        assert!(validate_ai_provider_config(&blank_path).is_err());
    }

    #[test]
    fn ai_config_blob_is_lazily_migrated_from_plaintext() {
        let crypto = CryptoService::from_key([7_u8; 32]);
        let store = Store::open_in_memory().unwrap();
        let plaintext = r#"{"api_key":"secret"}"#;
        store
            .save_ai_config(&AiConfig {
                id: ACTIVE_AI_CONFIG_ID.to_string(),
                provider_type: "generic".to_string(),
                config: plaintext.to_string(),
                is_enabled: true,
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();

        assert_eq!(
            decrypt_ai_config_with_store(&crypto, &store, plaintext).unwrap(),
            plaintext
        );

        let migrated_hex = store.get_ai_config().unwrap().unwrap().config;
        let migrated = hex_decode(&migrated_hex).unwrap();
        assert!(!CryptoService::ciphertext_needs_migration(&migrated));
        assert_eq!(
            crypto
                .decrypt_for(AI_CONFIG_PURPOSE, ACTIVE_AI_CONFIG_ID, &migrated)
                .unwrap(),
            plaintext.as_bytes()
        );
    }

    /// The AI secret must not decrypt with the translate config's purpose —
    /// that is the whole reason the two modules carry separate purposes.
    #[test]
    fn ai_config_ciphertext_is_not_readable_as_a_translate_config() {
        use crate::commands::encrypted_store::{
            ACTIVE_TRANSLATE_CONFIG_ID, TRANSLATE_CONFIG_PURPOSE,
        };

        let crypto = CryptoService::from_key([7_u8; 32]);
        let encrypted = encrypt_ai_config_with_crypto(&crypto, r#"{"api_key":"secret"}"#).unwrap();
        let bytes = hex_decode(&encrypted).unwrap();

        assert!(crypto
            .decrypt_for(TRANSLATE_CONFIG_PURPOSE, ACTIVE_TRANSLATE_CONFIG_ID, &bytes)
            .is_err());
    }

    #[test]
    fn decrypting_an_ai_config_does_not_touch_the_translate_row() {
        let crypto = CryptoService::from_key([7_u8; 32]);
        let store = Store::open_in_memory().unwrap();
        let now = now_timestamp();
        store
            .save_translate_config(&pebble_core::TranslateConfig {
                id: "active".to_string(),
                provider_type: "deepl".to_string(),
                config: "translate-blob".to_string(),
                is_enabled: true,
                created_at: now,
                updated_at: now,
            })
            .unwrap();
        store
            .save_ai_config(&AiConfig {
                id: ACTIVE_AI_CONFIG_ID.to_string(),
                provider_type: "generic".to_string(),
                config: r#"{"result_path":"x"}"#.to_string(),
                is_enabled: true,
                created_at: now,
                updated_at: now,
            })
            .unwrap();

        let _ = decrypt_ai_config_with_store(&crypto, &store, r#"{"result_path":"x"}"#).unwrap();

        assert_eq!(
            store.get_translate_config().unwrap().unwrap().config,
            "translate-blob"
        );
    }
}
