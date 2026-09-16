import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, RefreshCw, X } from "lucide-react";

export type AiReviewAction = "polish" | "proofread" | "translate" | "help_write";

interface Props {
  action: AiReviewAction;
  original: string;
  result: string;
  /** Which backend answered: `ai` or `translate` (the compose translate fallback). */
  engine: string;
  loading: boolean;
  error: string;
  copied: boolean;
  onCopy: () => void;
  onReplace: () => void;
  onInsertBelow: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const ACTION_LABEL_KEYS: Record<AiReviewAction, string> = {
  polish: "ai.polish",
  proofread: "ai.proofread",
  translate: "ai.translate",
  help_write: "ai.helpWrite",
};

/**
 * Side-by-side review of an AI result, mirroring the ConfirmDialog pattern:
 * Escape closes, focus is trapped, and nothing reaches the editor until the
 * user presses Replace or Insert below.
 */
export default function AiReviewDialog({
  action,
  original,
  result,
  engine,
  loading,
  error,
  copied,
  onCopy,
  onReplace,
  onInsertBelow,
  onRetry,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!loadingRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
      );
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? current <= 0 ? focusable.length - 1 : current - 1
        : current === focusable.length - 1 ? 0 : current + 1;
      e.preventDefault();
      focusable[next]?.focus();
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, []);

  const paneStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  };

  const paneLabelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  };

  const paneBodyStyle: React.CSSProperties = {
    flex: 1,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: "13px",
    lineHeight: 1.6,
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    maxHeight: "42vh",
  };

  const footerButtonStyle: React.CSSProperties = {
    padding: "7px 14px",
    borderRadius: "6px",
    fontSize: "13px",
    cursor: loading ? "wait" : "pointer",
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-primary)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-review-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        ref={dialogRef}
        style={{
          width: "680px",
          maxWidth: "calc(100vw - 48px)",
          backgroundColor: "var(--color-sidebar-bg)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3 id="ai-review-title" style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
            {t("ai.preview")}
            <span style={{ marginLeft: "8px", fontSize: "12px", fontWeight: 400, color: "var(--color-text-secondary)" }}>
              {t(ACTION_LABEL_KEYS[action])}
              {result && ` · ${engine === "translate" ? t("ai.engineTranslate") : t("ai.engineAi")}`}
            </span>
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={() => { if (!loading) onClose(); }}
            aria-label={t("ai.close")}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              color: "var(--color-text-secondary)",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", gap: "12px", minHeight: "160px" }}>
          <div style={paneStyle}>
            <span style={paneLabelStyle}>{t("ai.original")}</span>
            <div style={paneBodyStyle}>{original || "—"}</div>
          </div>
          <div style={paneStyle}>
            <span style={paneLabelStyle}>{t("ai.result")}</span>
            <div style={paneBodyStyle}>
              {loading ? (
                <span role="status" aria-live="polite" style={{ color: "var(--color-text-secondary)" }}>
                  {t("ai.running")}
                </span>
              ) : error ? (
                <span role="alert" style={{ color: "#dc3545" }}>{error}</span>
              ) : (
                result || "—"
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onCopy}
            disabled={!result || loading}
            style={{ ...footerButtonStyle, opacity: !result || loading ? 0.5 : 1 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t("ai.copied") : t("ai.copy")}
            </span>
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            style={{ ...footerButtonStyle, opacity: loading ? 0.5 : 1 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <RefreshCw size={13} />
              {t("ai.retry")}
            </span>
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => { if (!loading) onClose(); }}
              style={footerButtonStyle}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={onInsertBelow}
              disabled={!result || loading}
              style={{ ...footerButtonStyle, opacity: !result || loading ? 0.5 : 1 }}
            >
              {t("ai.insertBelow")}
            </button>
            <button
              type="button"
              onClick={onReplace}
              disabled={!result || loading}
              style={{
                ...footerButtonStyle,
                border: "none",
                background: "var(--color-accent)",
                color: "#fff",
                fontWeight: 600,
                opacity: !result || loading ? 0.5 : 1,
              }}
            >
              {t("ai.replace")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
