import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Copy, RefreshCw, Sparkles, X } from "lucide-react";
import { aiSummarizeMessage } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { profileLocalStorage } from "@/lib/profileStorage";

const LANGUAGE_OPTIONS = [
  { code: "zh", labelKey: "languages.chinese" },
  { code: "en", labelKey: "languages.english" },
  { code: "ja", labelKey: "languages.japanese" },
  { code: "ko", labelKey: "languages.korean" },
  { code: "fr", labelKey: "languages.french" },
  { code: "de", labelKey: "languages.german" },
  { code: "es", labelKey: "languages.spanish" },
] as const;

const PRIVACY_ACK_KEY = "pebble-ai-privacy-ack";

interface Props {
  messageId: string;
  onClose: () => void;
}

function defaultSummaryLanguage() {
  const uiLang = profileLocalStorage.getItem("pebble-language") || "zh";
  return LANGUAGE_OPTIONS.some((option) => option.code === uiLang) ? uiLang : "en";
}

/**
 * Collapsible summary panel for the message detail page.
 *
 * It never touches the message body — the summary lives in its own band above
 * the body — so reading a summary can't change what the mail says.
 */
export default function AiSummaryCard({ messageId, onClose }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState(defaultSummaryLanguage);
  const [privacyAcked, setPrivacyAcked] = useState(
    () => profileLocalStorage.getItem(PRIVACY_ACK_KEY) === "1",
  );

  // Only the newest request may write state: switching language while a request
  // is in flight must not let the old answer land.
  const requestIdRef = useRef(0);

  const run = useCallback(
    async (targetLang: string) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError("");
      try {
        const result = await aiSummarizeMessage(messageId, targetLang);
        if (requestId !== requestIdRef.current) return;
        setSummary(result.text);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(extractErrorMessage(err));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [messageId],
  );

  useEffect(() => {
    if (!privacyAcked) return;
    setSummary("");
    void run(language);
  }, [run, language, privacyAcked]);

  // Clear the "copied" confirmation on unmount too, so the timer can't fire
  // into a component that is already gone.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  function handleAcceptPrivacy() {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    setPrivacyAcked(true);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
  }

  const iconButtonStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px",
    display: "flex",
    alignItems: "center",
    color: "var(--color-text-secondary)",
  };

  return (
    <div
      className="ai-summary-card"
      style={{
        flexShrink: 0,
        margin: "12px 16px 0",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        background: "var(--color-bg-secondary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px" }}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("ai.expand") : t("ai.collapse")}
          title={collapsed ? t("ai.expand") : t("ai.collapse")}
          style={iconButtonStyle}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Sparkles size={14} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {t("ai.summaryTitle")}
        </span>
        <select
          aria-label={t("ai.summaryLanguage")}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={{
            marginLeft: "auto",
            fontSize: "11px",
            padding: "2px 4px",
            border: "1px solid var(--color-border)",
            borderRadius: "4px",
            backgroundColor: "var(--color-bg)",
            color: "var(--color-text-primary)",
          }}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void run(language)}
          disabled={loading || !privacyAcked}
          aria-label={t("ai.regenerate")}
          title={t("ai.regenerate")}
          style={{ ...iconButtonStyle, opacity: loading ? 0.5 : 1 }}
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ai.close")}
          title={t("ai.close")}
          style={iconButtonStyle}
        >
          <X size={14} />
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: "0 12px 10px", fontSize: "13px", lineHeight: 1.65, color: "var(--color-text-primary)" }}>
          {!privacyAcked ? (
            <div>
              <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--color-warning, #e67e22)" }}>
                {t("ai.privacyNotice")}
              </p>
              <button
                type="button"
                onClick={handleAcceptPrivacy}
                style={{
                  padding: "5px 12px",
                  border: "none",
                  borderRadius: "4px",
                  background: "var(--color-accent)",
                  color: "#fff",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                {t("translate.acceptAndContinue")}
              </button>
            </div>
          ) : loading ? (
            <div role="status" aria-live="polite" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {t("ai.summarizing")}
            </div>
          ) : error ? (
            <div role="alert" style={{ color: "#dc3545", fontSize: "13px" }}>
              <div>{t("ai.summaryFailed")}</div>
              <div style={{ fontSize: "12px", marginTop: "2px" }}>{error}</div>
            </div>
          ) : summary ? (
            <>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {summary.split("\n").map((line, i) => {
                  const bullet = /^\s*[-*]\s+/.test(line);
                  return (
                    <div
                      key={i}
                      style={bullet ? { paddingLeft: "14px", textIndent: "-14px" } : undefined}
                    >
                      {bullet ? `\u2022 ${line.replace(/^\s*[-*]\s+/, "")}` : line}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void handleCopy()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  marginTop: "8px",
                  padding: "4px 8px",
                  border: "1px solid var(--color-border)",
                  borderRadius: "4px",
                  background: "transparent",
                  color: "var(--color-text-secondary)",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? t("ai.copied") : t("ai.copy")}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
