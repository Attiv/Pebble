use crate::types::{AiLength, AiTone};

/// Map a BCP-47-ish language code to a name the model understands.
/// Falls back to the raw code so custom values still reach the model.
pub fn language_name(code: &str) -> String {
    let normalized = code.trim().to_ascii_lowercase();
    let base = normalized.split(['-', '_']).next().unwrap_or("");
    let name = match base {
        "zh" => "Simplified Chinese",
        "en" => "English",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "de" => "German",
        "es" => "Spanish",
        "pt" => "Portuguese",
        "ru" => "Russian",
        "it" => "Italian",
        "nl" => "Dutch",
        "ar" => "Arabic",
        "hi" => "Hindi",
        "th" => "Thai",
        "vi" => "Vietnamese",
        "auto" | "" => return "the same language as the input".to_string(),
        _ => return code.trim().to_string(),
    };
    name.to_string()
}

/// Shared output contract: the result is dropped straight into an editor, so
/// the model must not wrap it in markdown fences or add commentary.
const OUTPUT_CONTRACT: &str =
    "Return ONLY the resulting text. Do not wrap it in code fences or quotes, \
     do not add explanations, and keep every line break that belongs to the result.";

pub fn summarize(content: &str, target_lang: &str) -> (String, String) {
    let system = format!(
        "You are an email assistant that summarises received mail for a busy reader. \
         Write the summary in {}. \
         Start with one sentence stating what the email is about, then list the key \
         points as at most five short bullet points prefixed with \"- \". \
         Preserve names, dates, amounts and action items exactly. \
         Never invent details that are not in the email. {OUTPUT_CONTRACT}",
        language_name(target_lang),
    );
    (system, content.to_string())
}

pub fn polish(text: &str, tone: AiTone) -> (String, String) {
    let system = format!(
        "You are an editor who rewrites email drafts. Rewrite the text so it reads \
         {} while keeping the original language, meaning, facts and line breaks. \
         Do not add new information and do not answer the email. {OUTPUT_CONTRACT}",
        tone.describe(),
    );
    (system, text.to_string())
}

pub fn proofread(text: &str) -> (String, String) {
    let system = format!(
        "You are a proofreader. Fix grammar, spelling, punctuation and typos in the \
         text. Keep the original language, wording, tone and line breaks — change only \
         what is actually wrong. Do not rewrite sentences that are already correct and \
         do not add new content. {OUTPUT_CONTRACT}",
    );
    (system, text.to_string())
}

pub fn translate(text: &str, from: &str, to: &str) -> (String, String) {
    let system = format!(
        "You are a professional translator. Translate the text from {} to {}. \
         Keep the tone and formatting of the original. {OUTPUT_CONTRACT}",
        language_name(from),
        language_name(to),
    );
    (system, text.to_string())
}

/// `intent` is the user's short instruction ("tell Anna I'll be late on Friday").
/// `context` is the quoted thread the draft replies to, if any.
pub fn help_write(
    intent: &str,
    tone: AiTone,
    length: AiLength,
    target_lang: &str,
    context: Option<&str>,
) -> (String, String) {
    let mut system = format!(
        "You are an assistant that drafts email bodies from a short instruction. \
         Write the body in {} in a {} tone, about {} long. \
         Include a greeting and a sign-off only when the instruction calls for one. \
         Do not write a subject line and do not add placeholder text such as \
         [your name] unless the instruction asks for it. {OUTPUT_CONTRACT}",
        language_name(target_lang),
        tone.describe(),
        length.describe(),
    );

    let user = match context.map(str::trim).filter(|c| !c.is_empty()) {
        Some(context) => {
            system.push_str(
                " The instruction may refer to the quoted message below; stay consistent with it.",
            );
            format!("Quoted message:\n{context}\n\nInstruction: {intent}")
        }
        None => format!("Instruction: {intent}"),
    };

    (system, user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_codes_map_to_names() {
        assert_eq!(language_name("zh"), "Simplified Chinese");
        assert_eq!(language_name("en-US"), "English");
        assert_eq!(language_name("auto"), "the same language as the input");
    }

    #[test]
    fn unknown_language_codes_pass_through() {
        assert_eq!(language_name("isv"), "isv");
    }

    #[test]
    fn help_write_quotes_context_only_when_present() {
        let (_, user) = help_write("Say hi", AiTone::Neutral, AiLength::Short, "en", None);
        assert_eq!(user, "Instruction: Say hi");

        let (system, user) = help_write(
            "Say hi",
            AiTone::Neutral,
            AiLength::Short,
            "en",
            Some("  earlier mail  "),
        );
        assert!(user.contains("earlier mail"));
        assert!(system.contains("quoted message"));
    }

    #[test]
    fn every_prompt_forbids_markdown_fences() {
        let prompts = [
            summarize("body", "en").0,
            polish("body", AiTone::Formal).0,
            proofread("body").0,
            translate("body", "en", "zh").0,
        ];
        for prompt in prompts {
            assert!(prompt.contains("Do not wrap it in code fences"));
        }
    }
}
