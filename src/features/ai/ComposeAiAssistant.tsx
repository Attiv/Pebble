import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Languages, PenLine, Sparkles, SpellCheck, Wand2 } from "lucide-react";
import { aiHelpWrite, aiPolish, aiProofread, aiTranslate } from "@/lib/api";
import type { AiLength, AiTone } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { profileLocalStorage } from "@/lib/profileStorage";
import { plainTextToParagraphs } from "@/hooks/useComposeEditor";
import type { EditorMode } from "@/hooks/useComposeEditor";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useToastStore } from "@/stores/toast.store";
import AiReviewDialog from "./AiReviewDialog";
import type { AiReviewAction } from "./AiReviewDialog";

const PRIVACY_ACK_KEY = "pebble-ai-privacy-ack";

const TARGET_LANGUAGES = [
  { code: "zh", labelKey: "languages.chinese" },
  { code: "en", labelKey: "languages.english" },
  { code: "ja", labelKey: "languages.japanese" },
  { code: "ko", labelKey: "languages.korean" },
  { code: "fr", labelKey: "languages.french" },
  { code: "de", labelKey: "languages.german" },
  { code: "es", labelKey: "languages.spanish" },
] as const;

const TONES: { value: AiTone; labelKey: string }[] = [
  { value: "neutral", labelKey: "ai.toneNeutral" },
  { value: "formal", labelKey: "ai.toneFormal" },
  { value: "friendly", labelKey: "ai.toneFriendly" },
  { value: "concise", labelKey: "ai.toneConcise" },
];

const LENGTHS: { value: AiLength; labelKey: string }[] = [
  { value: "short", labelKey: "ai.lengthShort" },
  { value: "medium", labelKey: "ai.lengthMedium" },
  { value: "long", labelKey: "ai.lengthLong" },
];

const ACTIONS: { value: AiReviewAction; labelKey: string; icon: React.ElementType }[] = [
  { value: "polish", labelKey: "ai.polish", icon: Wand2 },
  { value: "proofread", labelKey: "ai.proofread", icon: SpellCheck },
  { value: "translate", labelKey: "ai.translate", icon: Languages },
  { value: "help_write", labelKey: "ai.helpWrite", icon: PenLine },
];

/** Where the next write goes. `rich` addresses the TipTap document by position;
 *  `raw` addresses the markdown/HTML textarea by character offset. */
interface Scope {
  text: string;
  from: number;
  to: number;
  mode: "rich" | "raw";
}

interface Props {
  editor: Editor | null;
  editorMode: EditorMode;
  rawSource: string;
  setRawSource: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  quotedReplyHtml: string;
}

function uiLanguage() {
  const lang = profileLocalStorage.getItem("pebble-language") || "zh";
  return TARGET_LANGUAGES.some((option) => option.code === lang) ? lang : "en";
}

function plainTextFromHtml(html: string) {
  if (!html.trim()) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
}

/**
 * The AI writing tools for the composer: polish, proofread, translate and
 * help-write.
 *
 * Every action collects its options first, runs against the configured AI
 * service, and lands in {@link AiReviewDialog} for confirmation — nothing is
 * written into the editor until the user picks Replace or Insert below.
 */
export default function ComposeAiAssistant({
  editor,
  editorMode,
  rawSource,
  setRawSource,
  textareaRef,
  quotedReplyHtml,
}: Props) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<AiReviewAction | null>(null);
  const [tone, setTone] = useState<AiTone>("neutral");
  const [length, setLength] = useState<AiLength>("medium");
  const [targetLang, setTargetLang] = useState(uiLanguage);
  const [intent, setIntent] = useState("");

  const [privacyAcked, setPrivacyAcked] = useState(
    () => profileLocalStorage.getItem(PRIVACY_ACK_KEY) === "1",
  );

  const [scope, setScope] = useState<Scope | null>(null);
  const [result, setResult] = useState("");
  const [engine, setEngine] = useState("ai");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  function readScope(): Scope | null {
    if (editorMode === "rich") {
      if (!editor) return null;
      const { from, to, empty } = editor.state.selection;
      const size = editor.state.doc.content.size;
      if (empty) {
        return {
          text: editor.state.doc.textBetween(0, size, "\n"),
          from: 0,
          to: size,
          mode: "rich",
        };
      }
      return {
        text: editor.state.doc.textBetween(from, to, "\n"),
        from,
        to,
        mode: "rich",
      };
    }

    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    if (end > start) {
      return { text: rawSource.slice(start, end), from: start, to: end, mode: "raw" };
    }
    return { text: rawSource, from: 0, to: rawSource.length, mode: "raw" };
  }

  /** HTML mode's source is markup, so generated text has to be escaped into it. */
  function renderForEditor(text: string, separate: boolean) {
    if (editorMode === "markdown") {
      return separate ? `\n\n${text}` : text;
    }
    const paragraphs = plainTextToParagraphs(text);
    return separate ? `<p><br></p>${paragraphs}` : paragraphs;
  }

  function writeReplace(target: Scope, text: string) {
    if (target.mode === "rich") {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: target.from, to: target.to }, plainTextToParagraphs(text))
        .run();
      return;
    }
    setRawSource(rawSource.slice(0, target.from) + renderForEditor(text, false) + rawSource.slice(target.to));
  }

  function writeInsertBelow(target: Scope, text: string) {
    if (target.mode === "rich") {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContentAt(target.to, `<p><br></p>${plainTextToParagraphs(text)}`)
        .run();
      return;
    }
    setRawSource(rawSource.slice(0, target.to) + renderForEditor(text, true) + rawSource.slice(target.to));
  }

  async function run(selected: AiReviewAction, current: Scope) {
    setAction(selected);
    setScope(current);
    setResult("");
    setError("");
    setEngine("ai");
    setLoading(true);
    setMenuOpen(false);

    try {
      let text = "";
      if (selected === "polish") {
        const response = await aiPolish(current.text, tone);
        text = response.text;
        setEngine(response.engine);
      } else if (selected === "proofread") {
        const response = await aiProofread(current.text);
        text = response.text;
        setEngine(response.engine);
      } else if (selected === "translate") {
        const response = await aiTranslate(current.text, "auto", targetLang);
        text = response.text;
        setEngine(response.engine);
      } else {
        const context = plainTextFromHtml(quotedReplyHtml);
        const response = await aiHelpWrite(
          intent,
          tone,
          length,
          targetLang,
          context || undefined,
        );
        text = response.text;
        setEngine(response.engine);
      }
      setResult(text);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handlePick(selected: AiReviewAction) {
    const current = readScope();
    if (!current) return;

    if (selected === "help_write") {
      // Help-write is the one action that is meant to work on an empty
      // composer: the intent, not the draft, is what it reads.
      if (!intent.trim()) {
        setAction("help_write");
        setScope(current);
        setResult("");
        setError("");
        return;
      }
      void run(selected, current);
      return;
    }

    if (!current.text.trim()) {
      useToastStore.getState().addToast({ message: t("ai.emptySelection"), type: "error" });
      setMenuOpen(false);
      return;
    }
    void run(selected, current);
  }

  function handleAcceptPrivacy() {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    setPrivacyAcked(true);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(result);
    setCopied(true);
  }

  function closeReview() {
    setAction(null);
    setScope(null);
    setResult("");
    setError("");
    setIntent("");
  }

  const selectStyle: React.CSSProperties = {
    fontSize: "12px",
    padding: "4px 6px",
    border: "1px solid var(--color-border)",
    borderRadius: "4px",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
  };

  const panelStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: "240px",
    padding: "8px",
    borderRadius: "8px",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: 900,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  };

  const menuItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--color-text-primary)",
    fontSize: "12px",
    cursor: "pointer",
    textAlign: "left",
  };

  const isHelpWrite = action === "help_write" && !result && !loading && !error;

  return (
    <div ref={menuRef} style={{ position: "relative", marginLeft: "auto" }}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        title={t("ai.menuTooltip")}
        aria-label={t("ai.menuTooltip")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`compose-toolbar-text-button${menuOpen ? " is-active" : ""}`}
      >
        <Sparkles size={13} />
        {t("ai.menu")}
      </button>

      {menuOpen && (
        <div role="menu" style={panelStyle}>
          {!privacyAcked ? (
            <div style={{ padding: "4px", maxWidth: "280px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "12px", lineHeight: 1.5, color: "var(--color-warning, #e67e22)" }}>
                {t("ai.privacyNotice")}
              </p>
              <button type="button" onClick={handleAcceptPrivacy} className="compose-toolbar-text-button is-active">
                {t("translate.acceptAndContinue")}
              </button>
            </div>
          ) : isHelpWrite ? (
            <>
              <label htmlFor="ai-intent" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                {t("ai.intent")}
              </label>
              <textarea
                id="ai-intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={t("ai.intentPlaceholder")}
                rows={3}
                autoFocus
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  resize: "vertical",
                  fontSize: "12px",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text-primary)",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label htmlFor="ai-tone" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {t("ai.tone")}
                </label>
                <select id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value as AiTone)} style={selectStyle}>
                  {TONES.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                  ))}
                </select>
                <label htmlFor="ai-length" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {t("ai.length")}
                </label>
                <select id="ai-length" value={length} onChange={(e) => setLength(e.target.value as AiLength)} style={selectStyle}>
                  {LENGTHS.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => handlePick("help_write")}
                disabled={!intent.trim()}
                className="compose-toolbar-text-button is-active"
                style={{ opacity: intent.trim() ? 1 : 0.5 }}
              >
                {t("ai.generate")}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px 4px" }}>
                <label htmlFor="ai-target-lang" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {t("ai.summaryLanguage")}
                </label>
                <select
                  id="ai-target-lang"
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value as typeof targetLang)}
                  style={selectStyle}
                >
                  {TARGET_LANGUAGES.map((option) => (
                    <option key={option.code} value={option.code}>{t(option.labelKey)}</option>
                  ))}
                </select>
                <label htmlFor="ai-menu-tone" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                  {t("ai.tone")}
                </label>
                <select id="ai-menu-tone" value={tone} onChange={(e) => setTone(e.target.value as AiTone)} style={selectStyle}>
                  {TONES.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </div>
              {ACTIONS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="menuitem"
                    onClick={() => handlePick(item.value)}
                    style={menuItemStyle}
                  >
                    <Icon size={14} />
                    {t(item.labelKey)}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {action && scope && (
        <AiReviewDialog
          action={action}
          original={scope.text}
          result={result}
          engine={engine}
          loading={loading}
          error={error}
          copied={copied}
          onCopy={() => void handleCopy()}
          onReplace={() => {
            writeReplace(scope, result);
            closeReview();
          }}
          onInsertBelow={() => {
            writeInsertBelow(scope, result);
            closeReview();
          }}
          onRetry={() => void run(action, scope)}
          onClose={closeReview}
        />
      )}
    </div>
  );
}
