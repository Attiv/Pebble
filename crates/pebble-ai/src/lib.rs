pub mod prompt;
pub mod types;

use pebble_core::{HttpProxyConfig, PebbleError, Result};
use pebble_translate::generic::resolve_json_path;
use pebble_translate::llm::{chat_url, extract_content_or_error};
use pebble_translate::TranslateService;
use types::{AiLength, AiProviderConfig, AiTone};

/// The AI assistant service.
///
/// It reuses the translate module's transport plumbing (`http_client_with_proxy`
/// and the OpenAI-compatible wire format helpers) but owns its own provider
/// configuration, prompts and error type. Nothing here reads or writes the
/// translate configuration.
pub struct AiService;

impl AiService {
    /// Same client policy as the translate module: ignore ambient proxy env
    /// vars, honour only the explicitly configured SOCKS5 proxy.
    pub fn http_client_with_proxy(proxy: Option<&HttpProxyConfig>) -> Result<reqwest::Client> {
        TranslateService::http_client_with_proxy(proxy)
    }

    /// Low-level call: send a system/user pair and return the model's text.
    pub async fn complete(
        config: &AiProviderConfig,
        proxy: Option<&HttpProxyConfig>,
        system: &str,
        user: &str,
    ) -> Result<String> {
        let client = Self::http_client_with_proxy(proxy)?;

        match config {
            AiProviderConfig::OpenAiCompatible {
                endpoint,
                api_key,
                model,
                mode,
            } => {
                let body = match mode {
                    types::LLMMode::Completions => serde_json::json!({
                        "model": model,
                        "messages": [
                            { "role": "system", "content": system },
                            { "role": "user", "content": user }
                        ],
                    }),
                    types::LLMMode::Responses => serde_json::json!({
                        "model": model,
                        "instructions": system,
                        "input": user,
                    }),
                };

                let json =
                    post_json(&client, &chat_url(endpoint, mode), Some(api_key), &body).await?;

                // An empty answer is a failure, not an empty summary: returning
                // "" here surfaced as a blank card with no explanation.
                extract_content_or_error(mode, &json).map_err(PebbleError::Ai)
            }
            AiProviderConfig::Generic {
                endpoint,
                api_key,
                model,
                prompt_param,
                result_path,
            } => {
                let mut body = serde_json::Map::new();
                body.insert(
                    prompt_param.clone(),
                    serde_json::Value::String(render_prompt(system, user)),
                );
                if let Some(model) = model.as_deref().filter(|m| !m.trim().is_empty()) {
                    body.insert(
                        "model".to_string(),
                        serde_json::Value::String(model.to_string()),
                    );
                }

                let json = post_json(
                    &client,
                    endpoint,
                    api_key.as_deref(),
                    &serde_json::Value::Object(body),
                )
                .await?;

                let text = resolve_json_path(&json, result_path)
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string();
                Ok(text)
            }
        }
    }

    pub async fn summarize(
        config: &AiProviderConfig,
        proxy: Option<&HttpProxyConfig>,
        content: &str,
        target_lang: &str,
    ) -> Result<String> {
        let (system, user) = prompt::summarize(content, target_lang);
        Self::complete(config, proxy, &system, &user).await
    }

    pub async fn polish(
        config: &AiProviderConfig,
        proxy: Option<&HttpProxyConfig>,
        text: &str,
        tone: AiTone,
    ) -> Result<String> {
        let (system, user) = prompt::polish(text, tone);
        Self::complete(config, proxy, &system, &user).await
    }

    pub async fn proofread(
        config: &AiProviderConfig,
        proxy: Option<&HttpProxyConfig>,
        text: &str,
    ) -> Result<String> {
        let (system, user) = prompt::proofread(text);
        Self::complete(config, proxy, &system, &user).await
    }

    /// Used by the compose "translate" action when an AI provider is configured.
    pub async fn translate(
        config: &AiProviderConfig,
        proxy: Option<&HttpProxyConfig>,
        text: &str,
        from: &str,
        to: &str,
    ) -> Result<String> {
        let (system, user) = prompt::translate(text, from, to);
        Self::complete(config, proxy, &system, &user).await
    }

    pub async fn help_write(
        config: &AiProviderConfig,
        proxy: Option<&HttpProxyConfig>,
        intent: &str,
        tone: AiTone,
        length: AiLength,
        target_lang: &str,
        context: Option<&str>,
    ) -> Result<String> {
        let (system, user) = prompt::help_write(intent, tone, length, target_lang, context);
        Self::complete(config, proxy, &system, &user).await
    }
}

fn render_prompt(system: &str, user: &str) -> String {
    format!("{system}\n\n{user}")
}

async fn post_json(
    client: &reqwest::Client,
    url: &str,
    api_key: Option<&str>,
    body: &serde_json::Value,
) -> Result<serde_json::Value> {
    let mut request = client.post(url).json(body);
    if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
        request = request.header("Authorization", format!("Bearer {key}"));
    }

    let response = request
        .send()
        .await
        .map_err(|e| PebbleError::Ai(format!("AI request failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(PebbleError::Ai(format!(
            "AI service error {status}: {body}"
        )));
    }

    response
        .json()
        .await
        .map_err(|e| PebbleError::Ai(format!("AI response parse failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;
    use types::LLMMode;

    /// Minimal one-shot HTTP stub: captures the raw request and replies with
    /// `body`. Returns the base URL and a handle to the captured request.
    fn stub_server(body: &'static str) -> (String, std::sync::Arc<std::sync::Mutex<String>>) {
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
                // Headers plus a small JSON body fit well inside one or two reads.
                if request.windows(4).any(|w| w == b"\r\n\r\n") && read < buf.len() {
                    break;
                }
            }
            *sink.lock().unwrap() = String::from_utf8_lossy(&request).to_string();

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });

        (format!("http://{address}"), captured)
    }

    #[test]
    fn renders_system_and_user_into_one_prompt() {
        assert_eq!(render_prompt("be nice", "say hi"), "be nice\n\nsay hi");
    }

    #[test]
    fn config_endpoint_is_shared_across_variants() {
        let openai = AiProviderConfig::OpenAiCompatible {
            endpoint: "https://api.example.com".into(),
            api_key: "k".into(),
            model: "m".into(),
            mode: LLMMode::Completions,
        };
        let generic = AiProviderConfig::Generic {
            endpoint: "https://other.example.com".into(),
            api_key: None,
            model: None,
            prompt_param: "prompt".into(),
            result_path: "text".into(),
        };
        assert_eq!(openai.endpoint(), "https://api.example.com");
        assert_eq!(generic.endpoint(), "https://other.example.com");
    }

    #[test]
    fn invalid_proxy_is_rejected_before_any_request() {
        let proxy = HttpProxyConfig {
            host: " ".into(),
            port: 7890,
        };
        assert!(AiService::http_client_with_proxy(Some(&proxy)).is_err());
    }

    #[tokio::test]
    async fn openai_compatible_call_posts_a_chat_completion_and_reads_the_reply() {
        let (base, captured) =
            stub_server(r#"{"choices":[{"message":{"content":"polished text"}}]}"#);
        let config = AiProviderConfig::OpenAiCompatible {
            endpoint: base,
            api_key: "secret-key".into(),
            model: "gpt-test".into(),
            mode: LLMMode::Completions,
        };

        let text = AiService::complete(&config, None, "SYSTEM-MARKER", "USER-MARKER")
            .await
            .unwrap();

        assert_eq!(text, "polished text");
        let request = captured.lock().unwrap().clone();
        assert!(request.starts_with("POST /v1/chat/completions "));
        assert!(request.contains("Bearer secret-key"));
        assert!(request.contains("SYSTEM-MARKER"));
        assert!(request.contains("USER-MARKER"));
        assert!(request.contains("\"model\":\"gpt-test\""));
    }

    #[tokio::test]
    async fn generic_call_uses_the_configured_prompt_field_and_result_path() {
        let (base, captured) = stub_server(r#"{"data":{"reply":"drafted body"}}"#);
        let config = AiProviderConfig::Generic {
            endpoint: format!("{base}/custom/generate"),
            api_key: None,
            model: Some("local-model".into()),
            prompt_param: "prompt".into(),
            result_path: "data.reply".into(),
        };

        let text = AiService::complete(&config, None, "SYSTEM-MARKER", "USER-MARKER")
            .await
            .unwrap();

        assert_eq!(text, "drafted body");
        let request = captured.lock().unwrap().clone();
        assert!(request.starts_with("POST /custom/generate "));
        assert!(request.contains("\"prompt\":"));
        assert!(request.contains("local-model"));
        assert!(!request.contains("Authorization"));
    }

    #[tokio::test]
    async fn ai_errors_are_not_reported_as_translate_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);

        let config = AiProviderConfig::OpenAiCompatible {
            endpoint: format!("http://{address}"),
            api_key: "k".into(),
            model: "m".into(),
            mode: LLMMode::Completions,
        };

        let error = AiService::complete(&config, None, "s", "u")
            .await
            .unwrap_err();
        assert!(matches!(error, PebbleError::Ai(_)), "got {error:?}");
    }

    /// A model that answers with nothing used to surface as an empty string,
    /// which the UI rendered as a blank card with no explanation.
    #[tokio::test]
    async fn an_empty_completion_is_an_error_rather_than_an_empty_answer() {
        let (base, _captured) =
            stub_server(r#"{"choices":[{"finish_reason":"length","message":{"content":""}}]}"#);
        let config = AiProviderConfig::OpenAiCompatible {
            endpoint: base,
            api_key: "k".into(),
            model: "m".into(),
            mode: LLMMode::Completions,
        };

        let error = AiService::complete(&config, None, "s", "u")
            .await
            .unwrap_err();

        assert!(matches!(error, PebbleError::Ai(_)), "got {error:?}");
        assert!(error.to_string().contains("carried no text"), "got {error}");
    }
}
