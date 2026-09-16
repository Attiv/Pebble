//! Asking an OpenAI-compatible endpoint which models it serves.
//!
//! Both the translate engine's LLM provider and the AI assistant post to
//! `/v1/chat/completions`, so both can ask the same endpoint for its model
//! list. Keeping the URL rule and the response parsing here stops the two
//! features from drifting into two slightly different notions of "the model
//! list endpoint".

use serde_json::Value;

/// Containers a model list is commonly wrapped in.
const LIST_KEYS: [&str; 4] = ["data", "models", "model", "result"];

/// Field names a model identifier hides behind.
const ID_KEYS: [&str; 4] = ["id", "name", "model", "slug"];

/// Longest error body echoed back to the user before it stops being useful.
const MAX_ERROR_BODY_CHARS: usize = 300;

/// URL of the model list for an OpenAI-compatible endpoint.
///
/// Users fill this field in by hand and the conventions vary, so accept the
/// three shapes that actually turn up: a bare host, a host already carrying
/// `/v1`, and a URL that already points at `/models`.
pub fn models_url(endpoint: &str) -> String {
    let base = endpoint.trim().trim_end_matches('/');
    if base.ends_with("/models") {
        return base.to_string();
    }
    if base.ends_with("/v1") {
        return format!("{base}/models");
    }
    format!("{base}/v1/models")
}

/// Model identifiers in a `/v1/models` payload.
///
/// The response is only *similar* to OpenAI's across providers: the array may
/// be called `data`, `models` or `result`, the entries may be objects with an
/// `id` or bare strings, and gateways sometimes nest the list one level deeper.
/// Anything unrecognised yields an empty list, which the caller reports as
/// "no models returned" rather than as a parse failure.
///
/// Sorted, because the field is a dropdown: a stable order keeps the list from
/// reshuffling between two fetches of the same endpoint, and the endpoint's own
/// order carries no documented meaning.
pub fn extract_model_ids(json: &Value) -> Vec<String> {
    let mut ids: Vec<String> = match find_list(json) {
        Some(items) => items.iter().filter_map(model_id_of).collect(),
        None => Vec::new(),
    };
    ids.sort();
    ids.dedup();
    ids
}

fn find_list(json: &Value) -> Option<&Vec<Value>> {
    if let Some(items) = json.as_array() {
        return Some(items);
    }
    for key in LIST_KEYS {
        match json.get(key) {
            Some(Value::Array(items)) => return Some(items),
            // Some gateways wrap the list one level deeper, e.g. {"data":{"models":[…]}}.
            Some(inner @ Value::Object(_)) => {
                if let Some(items) = find_list(inner) {
                    return Some(items);
                }
            }
            _ => {}
        }
    }
    None
}

fn model_id_of(item: &Value) -> Option<String> {
    if let Some(text) = item.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }
    let object = item.as_object()?;
    for key in ID_KEYS {
        if let Some(text) = object.get(key).and_then(Value::as_str) {
            let text = text.trim();
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

/// Fetch the model list from `endpoint`.
///
/// The error is a plain message rather than a [`pebble_core::PebbleError`]
/// because this code is shared by the translate engine and the AI assistant,
/// and each owns its own error variant: a failed listing must be reported as
/// whichever feature asked for it, never as the other one's problem.
pub async fn fetch_model_ids(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut request = client.get(models_url(endpoint));
    if let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Model list request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let body: String = body.trim().chars().take(MAX_ERROR_BODY_CHARS).collect();
        return Err(format!("Model list error {status}: {body}"));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Model list parse failed: {e}"))?;

    Ok(extract_model_ids(&json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_url_adds_the_version_segment_for_a_bare_host() {
        assert_eq!(
            models_url("https://api.openai.com"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.openai.com/"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn models_url_does_not_double_the_version_segment() {
        // The translate tab's placeholder ends in /v1, so this is the common case.
        assert_eq!(
            models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn models_url_keeps_a_url_that_already_points_at_models() {
        assert_eq!(
            models_url("https://gateway.example.com/openai/v1/models"),
            "https://gateway.example.com/openai/v1/models"
        );
    }

    #[test]
    fn models_url_ignores_surrounding_whitespace() {
        assert_eq!(
            models_url("  https://api.deepseek.com/v1/  "),
            "https://api.deepseek.com/v1/models"
        );
    }

    #[test]
    fn reads_the_openai_shape() {
        let json = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "gpt-4o-mini", "object": "model" },
                { "id": "gpt-4o", "object": "model" }
            ]
        });
        assert_eq!(extract_model_ids(&json), vec!["gpt-4o", "gpt-4o-mini"]);
    }

    #[test]
    fn reads_lists_of_plain_strings() {
        let json = serde_json::json!({ "data": ["b-model", "a-model"] });
        assert_eq!(extract_model_ids(&json), vec!["a-model", "b-model"]);

        let bare = serde_json::json!(["z-model", "a-model"]);
        assert_eq!(extract_model_ids(&bare), vec!["a-model", "z-model"]);
    }

    #[test]
    fn reads_a_models_array_that_names_the_field_differently() {
        let json = serde_json::json!({
            "models": [{ "name": "llama3.2" }, { "name": "qwen2.5" }]
        });
        assert_eq!(extract_model_ids(&json), vec!["llama3.2", "qwen2.5"]);
    }

    #[test]
    fn reads_a_list_nested_inside_an_envelope() {
        let json = serde_json::json!({ "data": { "models": [{ "id": "nested-model" }] } });
        assert_eq!(extract_model_ids(&json), vec!["nested-model"]);
    }

    #[test]
    fn de_duplicates_and_drops_blank_identifiers() {
        let json = serde_json::json!({
            "data": [{ "id": "dup" }, { "id": "dup" }, { "id": "  " }, { "object": "model" }]
        });
        assert_eq!(extract_model_ids(&json), vec!["dup"]);
    }

    #[test]
    fn an_unrecognised_payload_yields_no_models_instead_of_failing() {
        assert!(extract_model_ids(&serde_json::json!({ "error": "invalid key" })).is_empty());
        assert!(extract_model_ids(&serde_json::json!("nope")).is_empty());
    }

    /// A proxy that already points at `/models` must not be sent to
    /// `…/models/v1/models`.
    #[tokio::test]
    async fn fetch_requests_the_model_list_and_reads_it() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let captured = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = std::sync::Arc::clone(&captured);

        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let mut request = Vec::new();
            let mut buf = [0_u8; 1024];
            while let Ok(read) = stream.read(&mut buf) {
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..read]);
                if request.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            *sink.lock().unwrap() = String::from_utf8_lossy(&request).to_string();

            let body = r#"{"data":[{"id":"served-model"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let ids = fetch_model_ids(&client, &format!("http://{address}"), Some("secret-key"))
            .await
            .unwrap();

        assert_eq!(ids, vec!["served-model"]);
        let request = captured.lock().unwrap().clone();
        assert!(request.starts_with("GET /v1/models "), "got {request}");
        assert!(request.contains("Bearer secret-key"));
    }

    #[tokio::test]
    async fn a_rejected_key_surfaces_the_status_and_the_body() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();

        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut buf = [0_u8; 1024];
            let _ = stream.read(&mut buf);
            let body = r#"{"error":{"message":"Invalid API key"}}"#;
            let response = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let error = fetch_model_ids(&client, &format!("http://{address}"), Some("bad"))
            .await
            .unwrap_err();

        assert!(error.contains("401"), "got {error}");
        assert!(error.contains("Invalid API key"), "got {error}");
    }

    #[tokio::test]
    async fn an_omitted_key_sends_no_authorization_header() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let captured = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = std::sync::Arc::clone(&captured);

        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut buf = [0_u8; 1024];
            let read = stream.read(&mut buf).unwrap_or(0);
            *sink.lock().unwrap() = String::from_utf8_lossy(&buf[..read]).to_string();
            let body = r#"{"data":[]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let ids = fetch_model_ids(&client, &format!("http://{address}"), Some("   "))
            .await
            .unwrap();

        assert!(ids.is_empty());
        assert!(!captured.lock().unwrap().contains("Authorization"));
    }
}
