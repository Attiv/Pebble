import { useState } from "react";
import { translateText } from "@/lib/api";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import type { Message, RenderedHtml, TranslateResult } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useUIStore } from "@/stores/ui.store";
import { SOURCE_ECHO_CLASS } from "@/lib/sourceEcho";

// Translation cache: avoids re-translating on toggle or revisit (capped at 20 entries)
const translationCache = new Map<string, TranslateResult & { _isHtml?: boolean }>();
const TRANSLATION_CACHE_MAX = 20;
const CHUNK_SIZE = 30; // Max text nodes per translation request

/** The separator a batch is joined with; mirrors `llm.rs`'s `SEPARATOR`. */
const SEPARATOR = "⸻";

/**
 * Paragraphs shorter than this keep their translation but do not get the source
 * echoed underneath. Button labels, link captions and names are fragments rather
 * than paragraphs, and mirroring every one of them drowns a newsletter in noise.
 */
const SOURCE_ECHO_MIN_CHARS = 16;

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

/**
 * Tags that start a new block of prose. Used to work out where one paragraph
 * ends and the next begins, since the markup has no other way of saying so.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "CAPTION", "CENTER",
  "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
  "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "LI",
  "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY",
  "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** The block a text node belongs to — its nearest block-level ancestor. */
function paragraphOf(node: Text): Element | null {
  let element = node.parentElement;
  while (element) {
    if (BLOCK_TAGS.has(element.tagName)) return element;
    element = element.parentElement;
  }
  return null;
}

/**
 * Group the text nodes by the paragraph they sit in.
 *
 * This is what the echo is keyed on, and it has to be the paragraph rather than
 * the node. A single sentence like "We noticed you haven't viewed the report
 * <strong>Skye Jia</strong> shared with you" arrives as several text nodes, and
 * one read.ai newsletter produced eleven of them; echoing each node put the
 * English into the middle of the sentence, once per fragment, which is exactly
 * the "translation and original on one line" reading this was meant to fix.
 */
function groupByParagraph(nodes: Text[]): Map<Element, Text[]> {
  const groups = new Map<Element, Text[]>();
  for (const node of nodes) {
    const paragraph = paragraphOf(node);
    if (!paragraph) continue;
    const group = groups.get(paragraph);
    if (group) group.push(node);
    else groups.set(paragraph, [node]);
  }
  return groups;
}

/**
 * Match an engine's reply to the fragments it was sent for.
 *
 * The batch is joined with a separator, so a reply that still carries separators
 * is positional: part *n* answers fragment *n*. An engine that stops early
 * therefore leaves the tail unanswered rather than mis-paired, which is the
 * legitimate "partial" case and is passed straight through.
 *
 * What must never happen is pairing a merged reply positionally. A translator
 * handed a sentence that arrived split by `<strong>` will naturally translate
 * it as one sentence, and then the reply has a single part for several
 * fragments. Writing that part into fragment 0, and the following parts into
 * the fragments after it, shifts everything by one and leaves a fragment
 * holding a whole sentence the engine wrote — which is how a reader ended up
 * with the translation and the original running on from each other.
 *
 * So a single part for several fragments is only accepted via a line split that
 * accounts for every fragment, or when there is exactly one fragment to begin
 * with (nothing to shift against). Otherwise this returns nothing: those
 * fragments keep the sender's own words and the run is reported as partial. A
 * mis-paired reply is unrecoverable; a missing one is one toggle away from
 * being retried.
 */
function pairWithFragments(parts: string[], reply: string, wanted: number): string[] {
  // A reply that still carries separators is positional: the engine answers in
  // order and may stop early, which leaves the tail unanswered rather than
  // mis-paired. Stopping early is the legitimate "partial" case.
  if (parts.length > 1) return parts;
  // One part for several fragments means the separators are gone and the
  // fragments were merged into a single answer. Pairing that into the first
  // fragment is precisely the corruption this guards against.
  const byLine = reply
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line !== SEPARATOR);
  if (byLine.length === wanted) return byLine;
  // A single fragment cannot be mis-paired with anything, so a reflowed reply
  // is still its translation.
  if (wanted === 1 && reply.trim()) return [reply.trim()];
  return [];
}

/**
 * Print the reader the paragraph they just read in the message's own words,
 * once, underneath the whole paragraph rather than after every fragment of it.
 *
 * The look comes from {@link SOURCE_ECHO_CSS} in the shadow root, never from an
 * inline `style`: see `lib/sourceEcho` for why that distinction is the whole
 * point of this function's output.
 */
function echoSourceText(paragraph: Element, original: string) {
  const holder = paragraph.ownerDocument.createElement("span");
  holder.setAttribute("class", SOURCE_ECHO_CLASS);
  holder.textContent = original;
  paragraph.appendChild(holder);
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

    // The paragraph the echo belongs to, and its original wording, both captured
    // before anything is rewritten.
    const paragraphs = groupByParagraph(textNodes);
    const paragraphOriginals = new Map<Element, string>();
    for (const [paragraph, nodes] of paragraphs) {
      paragraphOriginals.set(
        paragraph,
        nodes.map((node) => node.textContent!.trim()).join(" "),
      );
    }
    const rewritten = new Set<Text>();
    const echoed = new Set<Element>();

    const snapshot = (): AnnotatedResult => ({
      translated: sanitizeHtml(doc.body.innerHTML),
      segments: [],
      _isHtml: true,
    });

    /**
     * Give every rewritten paragraph its original back — once, after the whole
     * paragraph. Run after each chunk so the progressive result reads the same
     * as the final one; `echoed` keeps it from stacking up duplicates.
     */
    const attachEchoes = () => {
      for (const [paragraph, nodes] of paragraphs) {
        if (echoed.has(paragraph)) continue;
        if (!nodes.some((node) => rewritten.has(node))) continue;
        const original = paragraphOriginals.get(paragraph) ?? "";
        if (original.length < SOURCE_ECHO_MIN_CHARS) continue;
        echoSourceText(paragraph, original);
        echoed.add(paragraph);
      }
    };

    // Uses a unique separator so we can reliably split the response, with a
    // checked fallback for services that reflow it away.
    let assigned = 0;
    let changed = 0;
    // Set when a batch came back with text that could not be paired 1:1 with
    // the fragments it was sent for.
    let mispaired = false;

    for (let start = 0; start < textNodes.length; start += CHUNK_SIZE) {
      const chunk = textNodes.slice(start, start + CHUNK_SIZE);
      const originals = chunk.map((node) => node.textContent!.trim());
      const batch = originals.join(`\n${SEPARATOR}\n`);
      const remote = await translateText(batch, "auto", targetLang);

      const parts = remote.translated
        .split(SEPARATOR)
        .map((part) => part.trim())
        .filter(Boolean);
      const replacements = pairWithFragments(parts, remote.translated, chunk.length);
      if (replacements.length === 0 && remote.translated.trim() !== "") {
        mispaired = true;
      }

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
        rewritten.add(node);
      }
      attachEchoes();
      // Show progressive results after each chunk
      setBilingualResult(snapshot());
    }

    if (assigned === 0) {
      // Text came back, it just never came back once per fragment. Saying
      // "empty" here would send the reader looking for the wrong problem.
      if (mispaired) {
        throw new BilingualFailure(
          "failed",
          "the engine did not answer once per fragment",
        );
      }
      throw new BilingualFailure("empty");
    }
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
