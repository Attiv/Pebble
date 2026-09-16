import { useState } from "react";
import { translateText } from "@/lib/api";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import type { Message, RenderedHtml, TranslateResult } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useUIStore } from "@/stores/ui.store";

// Translation cache: avoids re-translating on toggle or revisit (capped at 20 entries)
const translationCache = new Map<string, TranslateResult & { _isHtml?: boolean }>();
const TRANSLATION_CACHE_MAX = 20;
const CHUNK_SIZE = 30; // Max text nodes per translation request

/**
 * Text nodes shorter than this keep their translation but do not get the source
 * echoed underneath. Button labels, link captions and names are fragments rather
 * than paragraphs, and mirroring every one of them drowns a newsletter in noise.
 */
const SOURCE_ECHO_MIN_CHARS = 16;

/** The muted "original" line printed under a translated paragraph. */
const SOURCE_ECHO_STYLE = [
  "display:block",
  "margin-top:2px",
  "padding-left:8px",
  "border-left:2px solid #d0d0d0",
  "font-size:12px !important",
  "line-height:1.6",
  "color:#8a8a8a !important",
].join(";");

/** Elements whose text is code, not prose, and must never reach a translator. */
const UNTRANSLATABLE_TAGS = new Set(["STYLE", "SCRIPT", "TITLE", "NOSCRIPT", "TEXTAREA"]);

export type BilingualErrorCode = "failed" | "empty" | "unchanged" | "noText";

export interface BilingualError {
  code: BilingualErrorCode;
  detail?: string;
}

export interface BilingualWarning {
  code: "partial";
  done: number;
  total: number;
}

type AnnotatedResult = TranslateResult & { _isHtml?: boolean };

/**
 * Raised when the engine answered but the answer is unusable. Carrying a code
 * instead of only a message lets the message view explain the failure in the
 * reader's language, and lets "the engine returned the source unchanged" be
 * told apart from "the engine returned nothing at all".
 */
class BilingualFailure extends Error {
  code: BilingualErrorCode;
  detail?: string;

  constructor(code: BilingualErrorCode, detail?: string) {
    super(code);
    this.name = "BilingualFailure";
    this.code = code;
    this.detail = detail;
  }
}

function isBilingualFailure(error: unknown): error is BilingualFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "BilingualFailure"
  );
}

function toBilingualError(error: unknown): BilingualError {
  if (isBilingualFailure(error)) return { code: error.code, detail: error.detail };
  return { code: "failed", detail: extractErrorMessage(error) };
}

function isUntranslatableTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return UNTRANSLATABLE_TAGS.has(parent.tagName.toUpperCase());
}

function collectTextNodes(doc: Document): Text[] {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    if (!text.textContent?.trim()) continue;
    if (isUntranslatableTextNode(text)) continue;
    nodes.push(text);
  }
  return nodes;
}

/** Print the reader the paragraph they just read in the message's own words. */
function echoSourceText(node: Text, original: string) {
  const holder = node.ownerDocument.createElement("span");
  holder.setAttribute("style", SOURCE_ECHO_STYLE);
  holder.textContent = original;
  node.after(holder);
}

/**
 * Translate the message into the reader's own language, or nothing at all.
 *
 * The target language is the language the app is displayed in: a reader whose
 * interface is Chinese is reading the message because it is not Chinese. Sending
 * the text back in the language it arrived in — which is what a hand-picked
 * "opposite" default used to do — makes the feature look broken.
 */
export function useBilingualTranslation(
  messageId: string | null,
  rendered: RenderedHtml | null,
  message: Message | null,
) {
  const interfaceLanguage = useUIStore((state) => state.language);
  const [bilingualMode, setBilingualMode] = useState(false);
  const [bilingualResult, setBilingualResult] = useState<AnnotatedResult | null>(null);
  const [bilingualLoading, setBilingualLoading] = useState(false);
  const [bilingualError, setBilingualError] = useState<BilingualError | null>(null);
  const [bilingualWarning, setBilingualWarning] = useState<BilingualWarning | null>(null);

  async function translateHtml(html: string, targetLang: string): Promise<AnnotatedResult> {
    const doc = new DOMParser().parseFromString(sanitizeHtml(html), "text/html");
    const textNodes = collectTextNodes(doc);
    if (textNodes.length === 0) throw new BilingualFailure("noText");

    const snapshot = (): AnnotatedResult => ({
      translated: sanitizeHtml(doc.body.innerHTML),
      segments: [],
      _isHtml: true,
    });

    // Uses a unique separator so we can reliably split the response, with a
    // numbered-index fallback for services that reflow the separator away.
    const SEP = "\n⸻\n";
    let assigned = 0;
    let changed = 0;

    for (let start = 0; start < textNodes.length; start += CHUNK_SIZE) {
      const chunk = textNodes.slice(start, start + CHUNK_SIZE);
      const originals = chunk.map((node) => node.textContent!.trim());
      const batch = originals.join(SEP);
      const remote = await translateText(batch, "auto", targetLang);

      const parts = remote.translated
        .split("⸻")
        .map((part) => part.trim())
        .filter(Boolean);
      // Falling back to lines: a lone separator line is punctuation from the
      // batch, not a paragraph, so it must never overwrite a node.
      const replacements =
        parts.length === chunk.length
          ? parts
          : remote.translated
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== "" && line !== "⸻");

      const pairCount = Math.min(chunk.length, replacements.length);
      for (let i = 0; i < pairCount; i++) {
        const translated = replacements[i];
        if (!translated) continue;
        const node = chunk[i];
        const original = originals[i];
        node.textContent = translated;
        assigned += 1;
        if (translated === original) continue;
        changed += 1;
        if (original.length >= SOURCE_ECHO_MIN_CHARS) echoSourceText(node, original);
      }
      // Show progressive results after each chunk
      setBilingualResult(snapshot());
    }

    if (assigned === 0) throw new BilingualFailure("empty");
    if (changed === 0) throw new BilingualFailure("unchanged");

    const result = snapshot();
    // Only an unanswered paragraph is worth warning about. A paragraph the
    // engine translated back to itself was left alone on purpose — names,
    // numbers, signatures — and saying so would be noise.
    if (assigned < textNodes.length) {
      setBilingualWarning({ code: "partial", done: assigned, total: textNodes.length });
      // An incomplete run is not worth remembering: the next toggle retries it.
      return result;
    }

    remember(cacheKey(targetLang), result);
    return result;
  }

  async function translateBodyText(
    textToTranslate: string,
    targetLang: string,
  ): Promise<AnnotatedResult> {
    if (!textToTranslate.trim()) throw new BilingualFailure("noText");

    const remote = await translateText(textToTranslate, "auto", targetLang);
    if (!remote.translated.trim()) throw new BilingualFailure("empty");
    if (remote.translated.trim() === textToTranslate.trim()) {
      throw new BilingualFailure("unchanged");
    }

    // The engine pairs source and target lines; fall back to the whole body as a
    // single paragraph when it reports no usable segments.
    const segments =
      remote.segments && remote.segments.length > 0
        ? remote.segments
        : [{ source: textToTranslate, target: remote.translated }];

    const result: AnnotatedResult = { ...remote, segments, _isHtml: false };
    remember(cacheKey(targetLang), result);
    return result;
  }

  function cacheKey(targetLang: string) {
    return `${messageId}:${targetLang}`;
  }

  function remember(key: string, result: AnnotatedResult) {
    if (translationCache.size >= TRANSLATION_CACHE_MAX) {
      translationCache.delete(translationCache.keys().next().value!);
    }
    translationCache.set(key, result);
  }

  async function handleBilingualToggle() {
    if (bilingualMode) {
      setBilingualMode(false);
      return;
    }
    if (!message || !messageId) return;

    const targetLang = interfaceLanguage;
    const cached = translationCache.get(cacheKey(targetLang));
    if (cached) {
      setBilingualResult(cached);
      setBilingualError(null);
      setBilingualWarning(null);
      setBilingualMode(true);
      return;
    }

    setBilingualMode(true);
    setBilingualLoading(true);
    setBilingualError(null);
    setBilingualWarning(null);
    try {
      const result =
        rendered && rendered.html
          ? await translateHtml(rendered.html, targetLang)
          : await translateBodyText(
              message.body_text ||
                new DOMParser().parseFromString(message.body_html_raw || "", "text/html").body
                  .textContent ||
                "",
              targetLang,
            );
      setBilingualResult(result);
    } catch (err) {
      console.error("Translation failed:", err);
      setBilingualResult(null);
      setBilingualError(toBilingualError(err));
    } finally {
      setBilingualLoading(false);
    }
  }

  /** Reset bilingual state (call when messageId changes) */
  function resetBilingual() {
    setBilingualMode(false);
    setBilingualResult(null);
    setBilingualError(null);
    setBilingualWarning(null);
  }

  return {
    bilingualMode,
    bilingualResult,
    bilingualLoading,
    bilingualError,
    bilingualWarning,
    handleBilingualToggle,
    resetBilingual,
  };
}
