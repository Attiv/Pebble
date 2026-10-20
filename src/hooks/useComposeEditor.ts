import { useState, useEffect, useRef, useMemo } from "react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown as MarkdownExtension } from "tiptap-markdown";
import TurndownService from "turndown";
import { getSignature } from "@/lib/signatures";
import { sanitizeComposeQuoteHtml } from "@/lib/sanitizeHtml";
import { isForwardedMessageMarker } from "@/lib/forwardMarkers";
import type { Message } from "@/lib/ipc-types";
import type { TFunction } from "i18next";

export { isForwardedMessageMarker } from "@/lib/forwardMarkers";

export type EditorMode = "rich" | "markdown" | "html";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

interface UseComposeEditorArgs {
  fromAccountId: string;
  composeMode: string | null;
  composeReplyTo: Message | null;
  isReply: boolean;
  t: TFunction;
  restoredDraft: {
    editorMode?: EditorMode;
    rawSource?: string;
    richTextHtml?: string;
  } | null;
  prefillBody?: string;
}

interface BuildComposeEditorContentArgs {
  composeMode: string | null;
  composeReplyTo: Message | null;
  isReply: boolean;
  signatureHtml: string;
  prefillBody?: string;
}

interface ForwardHistoryOptions {
  label: string;
  /** Inline the whole visual treatment so mail clients keep the hierarchy. */
  inlineStyles?: boolean;
}

interface BuildForwardMessageHtmlArgs {
  composeReplyTo: Message | null;
  t: TFunction;
  inlineStyles?: boolean;
}

interface BuildReplyQuoteHtmlArgs {
  composeReplyTo: Message | null;
  t: TFunction;
}

interface ShouldApplyInitialEditorContentArgs {
  editorExists: boolean;
  initialized: boolean;
  signatureReady: boolean;
  hasRestoredDraft: boolean;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Turn plain text (as produced by the AI assistant) into editor paragraphs.
 * Shared with the AI module so generated text enters the rich editor the same
 * way a prefilled body does.
 */
export function plainTextToParagraphs(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>")
    .join("");
}

function parseBodyHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.innerHTML;
}

function decodeHtmlEntities(value: string) {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.body.textContent ?? "";
}

function startsWithEncodedHtmlTag(value: string) {
  return /^\s*(?:&lt;|&#0*60;|&#x0*3c;)\s*\/?[a-z][\w:-]*(?:\s|\/?(?:&gt;|&#0*62;|&#x0*3e;))/i.test(value);
}

function looksLikeHtml(value: string) {
  return /<\s*\/?[a-z][\w:-]*(?:\s|\/?>)/i.test(value);
}

export function extractComposeBodyHtml(html: string) {
  try {
    const source = html.trim();
    let body = parseBodyHtml(source);
    const decoded = decodeHtmlEntities(body).trim();

    if (startsWithEncodedHtmlTag(source) && decoded !== body.trim() && looksLikeHtml(decoded)) {
      body = parseBodyHtml(decoded);
    }

    return sanitizeComposeQuoteHtml(body);
  } catch {
    return `<p>${escapeHtml(html)}</p>`;
  }
}

export function buildComposeEditorContent({
  composeMode,
  composeReplyTo,
  isReply,
  signatureHtml,
  prefillBody,
}: BuildComposeEditorContentArgs) {
  try {
    if (isReply && composeReplyTo) {
      return `<p><br></p>${signatureHtml}`;
    }
    if (composeMode === "forward" && composeReplyTo) {
      // The forwarded message lives in its own read-only card below the editor.
      // Keeping it out of the TipTap document is what lets it keep its
      // structure (tables, nested history) and keeps the user's note at the
      // top level instead of flattened into the quoted content.
      return `<p><br></p>${signatureHtml}`;
    }
    if (composeMode === "new" && prefillBody?.trim()) {
      return `${plainTextToParagraphs(prefillBody)}${signatureHtml}`;
    }
    return signatureHtml;
  } catch (err) {
    console.error("[ComposeView] Failed to build editor content:", err);
    return "";
  }
}

function formatQuotedDate(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  return new Date(seconds * 1000).toLocaleString();
}

function formatAddressList(list: Message["to_list"]): string {
  return list
    .map((entry) => entry.name?.trim() ? `${entry.name.trim()} <${entry.address}>` : entry.address)
    .filter(Boolean)
    .join(", ");
}

// The same visual language as the reader's card (`forwardCardCss.ts`), in
// inline form: what Pebble sends has to survive mail clients that know
// nothing of our stylesheet.
const FORWARD_CARD_STYLE = [
  "margin:20px 0 0",
  "border:1px solid #e2e8f0",
  "border-radius:12px",
  "overflow:hidden",
  "background:#ffffff",
].join(";");

const FORWARD_HEADER_STYLE = [
  "padding:14px 18px 15px",
  "background:#f1f5fa",
  "background:linear-gradient(180deg,#f8fafd 0%,#eef3f9 100%)",
  "border-bottom:1px solid #e4eaf2",
].join(";");

const FORWARD_BADGE_STYLE = [
  "display:inline-block",
  "margin:0 0 7px",
  "padding:3px 10px",
  "border:1px solid #d3dff2",
  "border-radius:999px",
  "background:#e7eefb",
  "color:#33507a",
  "font-size:10px",
  "font-weight:700",
  "letter-spacing:0.09em",
  "text-transform:uppercase",
].join(";");

const FORWARD_SUBJECT_STYLE = [
  "margin:0 0 6px",
  "font-size:15px",
  "font-weight:600",
  "line-height:1.4",
  "color:#111827",
].join(";");

const FORWARD_META_STYLE = [
  "margin:0",
  "font-size:12px",
  "line-height:1.6",
  "color:#475467",
].join(";");

const FORWARD_BODY_STYLE = [
  "padding:16px 18px 18px",
  "color:#1f2937",
  "font-size:14px",
  "line-height:1.62",
].join(";");

const FORWARD_HISTORY_STYLE = [
  "margin:18px 0 0",
  "padding:10px 0 2px 14px",
  "border-left:2px solid #dbe2ed",
].join(";");

const FORWARD_HISTORY_LABEL_STYLE = [
  "display:inline-block",
  "margin:0 0 8px",
  "font-size:11px",
  "font-weight:700",
  "letter-spacing:0.08em",
  "text-transform:uppercase",
  "color:#97a1b2",
].join(";");

function styleAttribute(inlineStyles: boolean | undefined, css: string): string {
  return inlineStyles ? ` style="${css}"` : "";
}

function wrapForwardHistorySection(marker: Element, options: ForwardHistoryOptions) {
  const parent = marker.parentNode;
  if (!parent) return;

  const doc = marker.ownerDocument;
  const wrapper = doc.createElement("div");
  wrapper.className = "pebble-forward-history";
  if (options.inlineStyles) wrapper.setAttribute("style", FORWARD_HISTORY_STYLE);

  parent.insertBefore(wrapper, marker);
  let node: Node | null = marker;
  while (node) {
    const next: Node | null = node.nextSibling;
    wrapper.appendChild(node);
    node = next;
  }

  const label = doc.createElement("span");
  label.className = "pebble-forward-history__label";
  if (options.inlineStyles) label.setAttribute("style", FORWARD_HISTORY_LABEL_STYLE);
  label.textContent = options.label;
  marker.replaceWith(label);
}

/**
 * A forward card that is already inside the message body describes an older
 * hop in the chain. Wrap it in the same history shell as a flattened divider so
 * re-forwarding a Pebble forward keeps the newest card on top and the older one
 * one level down.
 */
function wrapForwardCardInHistory(card: Element, options: ForwardHistoryOptions) {
  const parent = card.parentNode;
  if (!parent) return;

  const doc = card.ownerDocument;
  const wrapper = doc.createElement("div");
  wrapper.className = "pebble-forward-history";
  if (options.inlineStyles) wrapper.setAttribute("style", FORWARD_HISTORY_STYLE);

  const label = doc.createElement("span");
  label.className = "pebble-forward-history__label";
  if (options.inlineStyles) label.setAttribute("style", FORWARD_HISTORY_LABEL_STYLE);
  label.textContent = options.label;

  parent.insertBefore(wrapper, card);
  wrapper.appendChild(label);
  wrapper.appendChild(card);
}

/**
 * Rebuild hierarchy for forward chains that were flattened into one level.
 *
 * Older builds pasted a forwarded message as a run of sibling paragraphs
 * (`---------- 转发邮件 ----------`, `发件人：…`, body, next divider …). Every
 * divider and everything after it becomes a nested block, so a chain of three
 * forwards ends up as three nested levels instead of one undifferentiated wall
 * of text. Blocks produced by this build already carry markers/classes and are
 * left as they are.
 */
export function structureForwardHistory(html: string, options: ForwardHistoryOptions): string {
  if (!html) return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.body;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(
      "p, div, span, font, b, strong, em, i, td, th, blockquote, section, article, center, " +
      "h1, h2, h3, h4, h5, h6",
    ));
    let markers = candidates.filter((element) => isForwardedMessageMarker(element.textContent ?? ""));
    // When a wrapper and the text node inside it both match (e.g. <p><b>…</b></p>),
    // keep the outermost element so the block that follows it is included.
    markers = markers.filter(
      (marker) => !markers.some((other) => other !== marker && other.contains(marker)),
    );
    for (const marker of markers) {
      wrapForwardHistorySection(marker, options);
    }

    // Cards produced by this build describe an older hop when they appear
    // inside another message's body. Give them the same history shell so
    // re-forwarding never leaves two visually identical levels.
    const embeddedCards = Array.from(root.querySelectorAll(".pebble-forward-card"))
      .filter((card) => !card.parentElement?.closest(".pebble-forward-history"));
    for (const card of embeddedCards) {
      wrapForwardCardInHistory(card, options);
    }

    if (markers.length === 0 && embeddedCards.length === 0) return html;
    return root.innerHTML;
  } catch {
    return html;
  }
}

function quotedMessageBodyHtml(message: Message): string {
  return message.body_html_raw
    ? extractComposeBodyHtml(message.body_html_raw)
    : `<p>${escapeHtml(message.body_text || "")}</p>`;
}

/** Body of the original message, ready to be shown next to the reply editor. */
export function buildReplyContextBodyHtml(message: Message, historyLabel: string): string {
  return structureForwardHistory(quotedMessageBodyHtml(message), {
    label: historyLabel,
    inlineStyles: false,
  });
}

/**
 * The forwarded message as a self-contained card: header (label, subject,
 * sender, date, recipients) plus an indented body. The card is the "latest"
 * level; any forward chain already inside the body becomes a nested
 * `.pebble-forward-history`, visibly subordinate to it.
 */
export function buildForwardMessageHtml({
  composeReplyTo,
  t,
  inlineStyles = false,
}: BuildForwardMessageHtmlArgs): string {
  if (!composeReplyTo) return "";

  const from = composeReplyTo.from_name?.trim()
    ? `${composeReplyTo.from_name.trim()} <${composeReplyTo.from_address}>`
    : (composeReplyTo.from_address || "");
  const subject = escapeHtml(composeReplyTo.subject || "");
  const date = formatQuotedDate(composeReplyTo.date);
  const to = formatAddressList(composeReplyTo.to_list);
  const cc = formatAddressList(composeReplyTo.cc_list);
  const badge = escapeHtml(t("compose.forwardedMessage", "Forwarded message"));
  const body = structureForwardHistory(quotedMessageBodyHtml(composeReplyTo), {
    label: t("compose.forwardedHistory", "Earlier message"),
    inlineStyles,
  });

  const metaLines = [
    t("compose.forwardedFrom", { sender: from }),
    date ? t("compose.forwardedDate", { date }) : "",
    to ? t("compose.forwardedTo", { recipients: to }) : "",
    cc ? t("compose.forwardedCc", { recipients: cc }) : "",
  ].filter(Boolean).map(escapeHtml);

  return [
    `<div class="pebble-forward-card"${styleAttribute(inlineStyles, FORWARD_CARD_STYLE)}>`,
    `<div class="pebble-forward-card__header"${styleAttribute(inlineStyles, FORWARD_HEADER_STYLE)}>`,
    `<div class="pebble-forward-badge"${styleAttribute(inlineStyles, FORWARD_BADGE_STYLE)}>${badge}</div>`,
    subject
      ? `<div class="pebble-forward-card__subject"${styleAttribute(inlineStyles, FORWARD_SUBJECT_STYLE)}>${subject}</div>`
      : "",
    ...metaLines.map((line) =>
      `<div class="pebble-forward-card__meta"${styleAttribute(inlineStyles, FORWARD_META_STYLE)}>${line}</div>`),
    `</div>`,
    `<div class="pebble-forward-card__body"${styleAttribute(inlineStyles, FORWARD_BODY_STYLE)}>${body}</div>`,
    `</div>`,
  ].join("");
}

export function buildReplyQuoteHtml({ composeReplyTo, t }: BuildReplyQuoteHtmlArgs) {
  if (!composeReplyTo) return "";

  const sender = composeReplyTo.from_name || composeReplyTo.from_address || "";
  const dateStr = formatQuotedDate(composeReplyTo.date);
  const body = structureForwardHistory(quotedMessageBodyHtml(composeReplyTo), {
    label: t("compose.forwardedHistory", "Earlier message"),
    inlineStyles: true,
  });
  const attribution = escapeHtml(
    t("compose.quoteAttribution", { date: dateStr, sender }),
  );

  return `<blockquote class="compose-original-quote" style="margin:16px 0 0;padding:0 0 0 12px;border-left:3px solid #d5dbe3;color:#667085"><p>${attribution}</p>${body}</blockquote>`;
}

export function appendReplyQuoteHtml(bodyHtml: string, quotedReplyHtml: string) {
  const quote = quotedReplyHtml.trim();
  if (!quote) return bodyHtml;
  const body = bodyHtml.trim() || "<p><br></p>";
  return `${body}<br/><br/>${quote}`;
}

/** Plain-text mirror of quoted content, for the message's text/plain part. */
export function quotedContextText(html: string): string {
  if (!html.trim()) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return "";
  }
}

export function appendQuotedContextText(bodyText: string, quotedText: string) {
  const quote = quotedText.trim();
  if (!quote) return bodyText;
  return bodyText.trim() ? `${bodyText.trim()}\n\n${quote}` : quote;
}

export function shouldApplyInitialEditorContent({
  editorExists,
  initialized,
  signatureReady,
  hasRestoredDraft,
}: ShouldApplyInitialEditorContentArgs) {
  if (!editorExists || initialized) return false;
  return hasRestoredDraft || signatureReady;
}

export function useComposeEditor({
  fromAccountId,
  composeMode,
  composeReplyTo,
  isReply,
  t,
  restoredDraft,
  prefillBody,
}: UseComposeEditorArgs) {
  const [editorMode, setEditorMode] = useState<EditorMode>(restoredDraft?.editorMode ?? "rich");
  const [rawSource, setRawSource] = useState(restoredDraft?.rawSource ?? prefillBody ?? "");
  const [richTextHtml, setRichTextHtml] = useState("");
  const [htmlPreview, setHtmlPreview] = useState(false);
  const [signature, setSignature] = useState("");
  const [signatureReady, setSignatureReady] = useState(Boolean(restoredDraft));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentInitializedRef = useRef(false);

  useEffect(() => {
    if (restoredDraft) {
      setSignatureReady(true);
      return;
    }
    let cancelled = false;
    setSignatureReady(false);
    getSignature(fromAccountId)
      .then((loaded) => {
        if (!cancelled) setSignature(loaded);
      })
      .catch((err) => {
        console.warn("Failed to load signature:", err);
        if (!cancelled) setSignature("");
      })
      .finally(() => {
        if (!cancelled) setSignatureReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fromAccountId, restoredDraft]);

  // Build signature HTML block
  const signatureHtml = useMemo(() => {
    const sig = signature;
    if (!sig) return "";
    return `<br/><br/><div style="color:var(--color-text-secondary);font-size:13px">--<br/>${escapeHtml(sig).replace(/\n/g, "<br/>")}</div>`;
  }, [signature]);

  const editorContent = useMemo(() => {
    return buildComposeEditorContent({ composeMode, composeReplyTo, isReply, signatureHtml, prefillBody });
  }, [composeMode, composeReplyTo, isReply, signatureHtml, prefillBody]);
  const quotedReplyHtml = useMemo(() => {
    return isReply ? buildReplyQuoteHtml({ composeReplyTo, t }) : "";
  }, [composeReplyTo, isReply, t]);
  const forwardedMessageHtml = useMemo(() => {
    return composeMode === "forward"
      ? buildForwardMessageHtml({ composeReplyTo, t, inlineStyles: false })
      : "";
  }, [composeMode, composeReplyTo, t]);
  const forwardedMessageEmailHtml = useMemo(() => {
    return composeMode === "forward"
      ? buildForwardMessageHtml({ composeReplyTo, t, inlineStyles: true })
      : "";
  }, [composeMode, composeReplyTo, t]);
  const quotedContextHtml = isReply ? quotedReplyHtml : forwardedMessageHtml;
  const quotedContextEmailHtml = isReply ? quotedReplyHtml : forwardedMessageEmailHtml;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: t("compose.editorPlaceholder", "Write your message...") }),
      MarkdownExtension.configure({ html: true, transformPastedText: true }),
    ],
    content: "",
  });

  // Set editor content after creation to avoid initialization crashes
  useEffect(() => {
    if (!shouldApplyInitialEditorContent({
      editorExists: Boolean(editor),
      initialized: contentInitializedRef.current,
      signatureReady,
      hasRestoredDraft: Boolean(restoredDraft),
    }) || !editor) return;
    // If restoring a draft, prefer its richTextHtml over generated editorContent
    if (restoredDraft?.richTextHtml) {
      editor.commands.setContent(restoredDraft.richTextHtml);
    } else if (editorContent) {
      editor.commands.setContent(editorContent);
    }
    if (isReply && !restoredDraft) {
      requestAnimationFrame(() => editor.commands.focus("start"));
    }
    if (composeMode === "forward" && !restoredDraft) {
      requestAnimationFrame(() => editor.commands.focus("start"));
    }
    contentInitializedRef.current = true;
  }, [editor, editorContent, isReply, composeMode, restoredDraft, signatureReady]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const syncRichTextHtml = () => {
      setRichTextHtml(editor.getHTML());
    };

    syncRichTextHtml();
    editor.on("update", syncRichTextHtml);

    return () => {
      editor.off("update", syncRichTextHtml);
    };
  }, [editor]);

  // Switch between modes, syncing content
  function switchMode(newMode: EditorMode) {
    if (newMode === editorMode || !editor) return;

    if (editorMode === "rich") {
      if (newMode === "markdown") {
        setRawSource(turndown.turndown(editor.getHTML()));
      } else {
        setRawSource(editor.getHTML());
      }
    } else if (editorMode === "markdown") {
      if (newMode === "rich") {
        editor.commands.setContent(rawSource);
      } else {
        editor.commands.setContent(rawSource);
        setRawSource(editor.getHTML());
      }
    } else {
      if (newMode === "rich") {
        editor.commands.setContent(rawSource);
      } else {
        setRawSource(turndown.turndown(rawSource));
      }
    }

    setEditorMode(newMode);
  }

  return {
    editor,
    editorMode,
    rawSource,
    setRawSource,
    richTextHtml,
    htmlPreview,
    setHtmlPreview,
    switchMode,
    textareaRef,
    quotedReplyHtml,
    forwardedMessageHtml,
    /** Preview/HTML used for AI context and the read-only panel. */
    quotedContextHtml,
    /** Email-safe variant appended to the outgoing body and saved drafts. */
    quotedContextEmailHtml,
  };
}
