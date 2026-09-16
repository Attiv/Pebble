use pebble_core::{PebbleError, Result};

use crate::deeplx::build_segments;
use crate::types::{LLMMode, TranslateResult};

/// URL for an OpenAI-compatible endpoint in the given mode.
///
/// Shared with `pebble-ai` so both modules speak the exact same dialect.
///
/// The field is filled in by hand and people write it both ways — the translate
/// tab's own placeholder ends in `/v1` — so a trailing version segment is
/// accepted rather than doubled into `/v1/v1/chat/completions`. This mirrors
/// [`crate::models::models_url`], so the model list and the calls that follow it
/// always agree on which base URL they are talking to.
pub fn chat_url(endpoint: &str, mode: &LLMMode) -> String {
    let base = endpoint.trim().trim_end_matches('/');
    let path = match mode {
        LLMMode::Completions => "chat/completions",
        LLMMode::Responses => "responses",
    };
    if base.ends_with("/v1") {
        return format!("{base}/{path}");
    }
    format!("{base}/v1/{path}")
}

/// Pull the generated text out of an OpenAI-compatible response body.
pub fn extract_content(mode: &LLMMode, json: &serde_json::Value) -> Option<String> {
    let text = match mode {
        LLMMode::Completions => json
            .get("choices")?
            .get(0)?
            .get("message")?
            .get("content")?
            .as_str()?,
        LLMMode::Responses => json
            .get("output")?
            .get(0)?
            .get("content")?
            .get(0)?
            .get("text")?
            .as_str()?,
    };
    Some(text.to_string())
}

#[allow(clippy::too_many_arguments)]
pub async fn translate(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    mode: &LLMMode,
    text: &str,
    from: &str,
    to: &str,
) -> Result<TranslateResult> {
    let system_prompt = format!(
        "You are a professional translator. Translate the following text from {from} to {to}. \
         Output ONLY the translation, nothing else. Preserve formatting and line breaks."
    );

    let body = match mode {
        LLMMode::Completions => serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": text }
            ],
            "temperature": 0.3,
        }),
        LLMMode::Responses => serde_json::json!({
            "model": model,
            "input": format!("{system_prompt}\n\n{text}"),
        }),
    };

    let resp = client
        .post(chat_url(endpoint, mode))
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| PebbleError::Translate(format!("LLM request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(PebbleError::Translate(format!(
            "LLM error {status}: {body_text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| PebbleError::Translate(format!("LLM parse failed: {e}")))?;

    let translated = extract_content(mode, &json).unwrap_or_default();

    Ok(TranslateResult {
        segments: build_segments(text, &translated),
        translated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_url_appends_the_mode_specific_path() {
        assert_eq!(
            chat_url("https://api.example.com/", &LLMMode::Completions),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            chat_url("https://api.example.com", &LLMMode::Responses),
            "https://api.example.com/v1/responses"
        );
    }

    #[test]
    fn chat_url_does_not_double_the_version_segment() {
        // The settings placeholder shows `…/v1`, so this is what people type.
        assert_eq!(
            chat_url("https://api.openai.com/v1", &LLMMode::Completions),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_url("  https://api.openai.com/v1/  ", &LLMMode::Responses),
            "https://api.openai.com/v1/responses"
        );
    }

    #[test]
    fn chat_url_and_models_url_agree_on_the_base() {
        // Whatever base the model list is read from must be the base the calls
        // go to, or the dropdown fills up while every request 404s.
        for endpoint in ["https://api.example.com", "https://api.example.com/v1"] {
            assert_eq!(
                crate::models::models_url(endpoint),
                "https://api.example.com/v1/models"
            );
            assert_eq!(
                chat_url(endpoint, &LLMMode::Completions),
                "https://api.example.com/v1/chat/completions"
            );
        }
    }

    #[test]
    fn extract_content_reads_completions_shape() {
        let json = serde_json::json!({
            "choices": [{ "message": { "content": "hello" } }]
        });
        assert_eq!(
            extract_content(&LLMMode::Completions, &json).as_deref(),
            Some("hello")
        );
    }

    #[test]
    fn extract_content_reads_responses_shape() {
        let json = serde_json::json!({
            "output": [{ "content": [{ "text": "hello" }] }]
        });
        assert_eq!(
            extract_content(&LLMMode::Responses, &json).as_deref(),
            Some("hello")
        );
    }

    #[test]
    fn extract_content_returns_none_for_unexpected_shapes() {
        let json = serde_json::json!({ "error": "nope" });
        assert!(extract_content(&LLMMode::Completions, &json).is_none());
        assert!(extract_content(&LLMMode::Responses, &json).is_none());
    }
}
