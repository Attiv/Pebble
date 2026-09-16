use serde::{Deserialize, Serialize};

pub use pebble_translate::types::LLMMode;

/// Provider configuration for the AI assistant.
///
/// This mirrors the shape of the translate module's `TranslateProviderConfig`
/// so the settings UI can reuse the same "provider + dynamic fields" pattern,
/// but it is a completely separate value: it lives in its own table, under its
/// own encryption purpose, and is never read by the translate module.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AiProviderConfig {
    /// OpenAI-compatible `/v1/chat/completions` or `/v1/responses`.
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible {
        endpoint: String,
        api_key: String,
        model: String,
        mode: LLMMode,
    },
    /// Escape hatch: name the request field that carries the prompt and the
    /// dotted path to the generated text in the response.
    #[serde(rename = "generic")]
    Generic {
        endpoint: String,
        api_key: Option<String>,
        model: Option<String>,
        /// Request field that receives the fully rendered prompt,
        /// e.g. `prompt` or `input`.
        prompt_param: String,
        /// Dotted path to the generated text, e.g. `data.0.content`.
        result_path: String,
    },
}

impl AiProviderConfig {
    pub fn endpoint(&self) -> &str {
        match self {
            AiProviderConfig::OpenAiCompatible { endpoint, .. }
            | AiProviderConfig::Generic { endpoint, .. } => endpoint,
        }
    }
}

/// The AI actions exposed by the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiAction {
    /// Summarise a received email (message detail page).
    Summarize,
    /// Improve the wording of a draft.
    Polish,
    /// Fix grammar, spelling and typos.
    Proofread,
    /// Translate a draft.
    Translate,
    /// Draft a new body from a short intent.
    HelpWrite,
}

/// Writing tone for `polish` and `help_write`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTone {
    Neutral,
    Formal,
    Friendly,
    Concise,
}

impl AiTone {
    pub fn describe(self) -> &'static str {
        match self {
            AiTone::Neutral => "natural and neutral",
            AiTone::Formal => "formal and professional",
            AiTone::Friendly => "warm and friendly",
            AiTone::Concise => "concise and to the point",
        }
    }
}

/// Target length for `help_write`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiLength {
    Short,
    Medium,
    Long,
}

impl AiLength {
    pub fn describe(self) -> &'static str {
        match self {
            AiLength::Short => "2 to 3 short sentences",
            AiLength::Medium => "one or two short paragraphs",
            AiLength::Long => "three to four paragraphs",
        }
    }
}

/// Result of an AI action. `text` is always plain text — never HTML — so the
/// caller decides how to escape and place it in the editor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResult {
    pub text: String,
    /// Which backend produced the text: `"ai"` or `"translate"`. The compose
    /// translate action can fall back to the configured translate engine, and
    /// the UI surfaces which one answered.
    pub engine: String,
}
