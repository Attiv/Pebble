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

/// The separator the message view joins paragraphs with before a batch runs.
///
/// It is spelled out in the prompt because a model that reflows it costs the
/// caller the 1:1 paragraph mapping it was relying on.
const SEPARATOR: &str = "⸻";

fn is_auto(code: &str) -> bool {
    matches!(code.trim().to_ascii_lowercase().as_str(), "" | "auto")
}

/// Language code as the language's own name.
///
/// An LLM is prompted in prose, so it should be told "Chinese (Simplified)"
/// rather than "zh" — codes are a DeepL/DeepLX convention, and a model asked to
/// translate "from auto to zh" is being asked to treat two codes as languages.
fn language_name(code: &str) -> String {
    match code.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" | "zh-hans-cn" | "cn" => "Chinese (Simplified)".to_string(),
        "zh-tw" | "zh-hant" | "zh-hk" => "Chinese (Traditional)".to_string(),
        "en" | "en-us" | "en-gb" => "English".to_string(),
        "ja" | "jp" => "Japanese".to_string(),
        "ko" | "kr" => "Korean".to_string(),
        "fr" => "French".to_string(),
        "de" => "German".to_string(),
        "es" => "Spanish".to_string(),
        "pt" => "Portuguese".to_string(),
        "it" => "Italian".to_string(),
        "ru" => "Russian".to_string(),
        "ar" => "Arabic".to_string(),
        other => other.to_string(),
    }
}

/// The instruction sent to an OpenAI-compatible chat endpoint.
pub fn system_prompt(from: &str, to: &str) -> String {
    let source = if is_auto(from) {
        "Detect the source language automatically.".to_string()
    } else {
        format!("The source language is {}.", language_name(from))
    };
    format!(
        "You are a professional translator. {source} Translate the following text to {}. \
         Output ONLY the translation, nothing else. \
         Preserve the original line breaks, and leave any line that consists only of \
         {SEPARATOR} exactly as it is.",
        language_name(to)
    )
}

/// Read text out of a `content` field, which is a string in most dialects and a
/// list of parts in some. Blank content counts as no content.
fn text_of(value: &serde_json::Value) -> Option<String> {
    let text = if let Some(text) = value.as_str() {
        text.to_string()
    } else {
        value
            .as_array()?
            .iter()
            .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
            .collect()
    };
    if text.trim().is_empty() {
        return None;
    }
    Some(text)
}

/// Pull the generated text out of an OpenAI-compatible response body.
pub fn extract_content(mode: &LLMMode, json: &serde_json::Value) -> Option<String> {
    match mode {
        LLMMode::Completions => {
            let choice = json.get("choices")?.get(0)?;
            // The legacy completions shape puts the text on the choice itself.
            choice
                .get("message")?
                .get("content")
                .and_then(text_of)
                .or_else(|| choice.get("text").and_then(text_of))
        }
        // A reasoning model can put a `reasoning` item before the answer, so the
        // text has to be collected across every output item rather than read
        // from a fixed index.
        LLMMode::Responses => {
            let items = json.get("output")?.as_array()?;
            let joined: String = items
                .iter()
                .filter_map(|item| item.get("content").and_then(text_of))
                .collect();
            if joined.is_empty() {
                return json.get("output_text").and_then(text_of);
            }
            Some(joined)
        }
    }
}

fn sorted_keys(value: &serde_json::Value) -> String {
    let Some(map) = value.as_object() else {
        return String::new();
    };
    let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
    keys.sort_unstable();
    format!("[{}]", keys.join(", "))
}

/// Describe the *shape* of a response that carried no text.
///
/// Fields are described by name only: the values are the model's answer, and an
/// answer can quote the message being translated. Reporting the shape is enough
/// to tell a wrong `mode` from an empty completion.
fn describe_shape(json: &serde_json::Value) -> String {
    let mut parts = vec![format!("top-level: {}", sorted_keys(json))];

    if let Some(choice) = json
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
    {
        parts.push(format!("choices[0]: {}", sorted_keys(choice)));
        if let Some(reason) = choice
            .get("finish_reason")
            .and_then(|reason| reason.as_str())
        {
            parts.push(format!("finish_reason: {reason}"));
        }
        if let Some(message) = choice.get("message") {
            parts.push(format!("message: {}", sorted_keys(message)));
        }
    }

    if let Some(items) = json.get("output").and_then(|output| output.as_array()) {
        let types: Vec<&str> = items
            .iter()
            .map(|item| {
                item.get("type")
                    .and_then(|kind| kind.as_str())
                    .unwrap_or("-")
            })
            .collect();
        parts.push(format!("output items: [{}]", types.join(", ")));
    }

    parts.join("; ")
}

/// Generated text, or an explanation of why the response held none.
///
/// Returning a reason instead of an empty string is the point: "the engine
/// answered with nothing" and "the engine answered with an empty translation"
/// look identical downstream, and both used to reach the reader as an
/// untranslated message that claimed to be translated.
pub fn extract_content_or_error(
    mode: &LLMMode,
    json: &serde_json::Value,
) -> std::result::Result<String, String> {
    if let Some(text) = extract_content(mode, json).filter(|text| !text.trim().is_empty()) {
        return Ok(text);
    }
    let mode_name = match mode {
        LLMMode::Completions => "completions",
        LLMMode::Responses => "responses",
    };
    Err(format!(
        "the {mode_name} response carried no text ({}); check that the configured mode matches the endpoint",
        describe_shape(json)
    ))
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
    let prompt = system_prompt(from, to);

    let body = match mode {
        LLMMode::Completions => serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": prompt },
                { "role": "user", "content": text }
            ],
            "temperature": 0.3,
        }),
        LLMMode::Responses => serde_json::json!({
            "model": model,
            "input": format!("{prompt}\n\n{text}"),
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

    let translated = extract_content_or_error(mode, &json).map_err(PebbleError::Translate)?;

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
    fn system_prompt_names_the_languages_instead_of_codes() {
        let prompt = system_prompt("en", "zh");
        assert!(prompt.contains("The source language is English."));
        assert!(prompt.contains("Translate the following text to Chinese (Simplified)."));
        // A language code is a translator-API convention, not prose.
        assert!(!prompt.contains("from en to zh"));
        assert!(prompt.contains(SEPARATOR));
    }

    #[test]
    fn system_prompt_asks_for_automatic_detection_when_the_source_is_auto() {
        // The message view sends `auto`: it has not detected the language, and
        // asking a model to translate "from auto" is asking it nothing.
        for source in ["auto", "", "AUTO"] {
            let prompt = system_prompt(source, "zh");
            assert!(prompt.contains("Detect the source language automatically."));
            assert!(!prompt
                .to_ascii_lowercase()
                .contains("source language is auto"));
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
    fn extract_content_reads_content_parts() {
        let json = serde_json::json!({
            "choices": [{ "message": { "content": [
                { "type": "text", "text": "hello " },
                { "type": "text", "text": "world" }
            ] } }]
        });
        assert_eq!(
            extract_content(&LLMMode::Completions, &json).as_deref(),
            Some("hello world")
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

    /// A reasoning model emits a `reasoning` item before the answer, so reading
    /// `output[0].content[0].text` finds nothing where text does exist.
    #[test]
    fn extract_content_skips_reasoning_items_in_responses() {
        let json = serde_json::json!({
            "output": [
                { "type": "reasoning", "summary": [] },
                { "type": "message", "content": [{ "type": "output_text", "text": "你好" }] }
            ]
        });
        assert_eq!(
            extract_content(&LLMMode::Responses, &json).as_deref(),
            Some("你好")
        );
    }

    #[test]
    fn extract_content_returns_none_for_unexpected_shapes() {
        let json = serde_json::json!({ "error": "nope" });
        assert!(extract_content(&LLMMode::Completions, &json).is_none());
        assert!(extract_content(&LLMMode::Responses, &json).is_none());
    }

    #[test]
    fn extract_content_returns_none_for_an_empty_completion() {
        let json = serde_json::json!({
            "choices": [{ "finish_reason": "length", "message": { "content": "" } }]
        });
        assert!(extract_content(&LLMMode::Completions, &json).is_none());
    }

    #[test]
    fn extract_content_or_error_names_the_shape_instead_of_going_quiet() {
        let json = serde_json::json!({
            "choices": [{ "finish_reason": "length", "message": { "content": null, "role": "assistant" } }]
        });
        let error = extract_content_or_error(&LLMMode::Completions, &json).unwrap_err();

        assert!(error.contains("completions response carried no text"));
        assert!(error.contains("finish_reason: length"));
        assert!(error.contains("message: [content, role]"));
    }

    #[test]
    fn extract_content_or_error_reports_a_responses_mode_mismatch() {
        // Pointing the responses mode at a chat-completions body.
        let json = serde_json::json!({ "choices": [{ "message": { "content": "hi" } }] });
        let error = extract_content_or_error(&LLMMode::Responses, &json).unwrap_err();

        assert!(error.contains("responses response carried no text"));
        assert!(error.contains("top-level: [choices]"));
    }

    #[test]
    fn extract_content_or_error_returns_the_text_when_there_is_some() {
        let json = serde_json::json!({ "choices": [{ "message": { "content": "你好" } }] });
        assert_eq!(
            extract_content_or_error(&LLMMode::Completions, &json).unwrap(),
            "你好"
        );
    }
}
