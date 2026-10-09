import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isSupportedLink } from "@/lib/openMessageLink";
import { useToastStore } from "@/stores/toast.store";

interface Props {
  href: string;
  position: { x: number; y: number };
  /** Follow the link — mailto opens compose, web links go to the browser. */
  onOpen: (href: string) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 320;

/**
 * The menu a right click on a link inside a message body opens.
 *
 * The body is rendered in a shadow root, where the webview's own "Copy Link"
 * entry never appears, so the address had no way out of the app at all. This
 * puts the address on screen — selectable by hand if the clipboard is
 * unavailable — next to the two things a reader actually wants from a link
 * they are not ready to click.
 */
export default function LinkActionPopover({ href, position, onOpen, onClose }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const canOpen = isSupportedLink(href);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  // Keep the menu on screen no matter where in the body the link sits.
  const left = Math.max(8, Math.min(position.x, window.innerWidth - POPOVER_WIDTH - 8));
  const top = Math.max(8, Math.min(position.y + 10, window.innerHeight - 96));

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch (err) {
      // The address stays on screen, so a refused clipboard is recoverable —
      // but say so instead of leaving the reader with a copy that never landed.
      console.warn("Failed to copy message link", err);
      useToastStore.getState().addToast({
        message: t("linkActions.copyFailed", "Could not copy the link"),
        type: "error",
      });
    }
  }

  return (
    <div
      className="pebble-popover-enter"
      role="menu"
      aria-label={t("linkActions.label", "Link actions")}
      style={{
        position: "fixed",
        left,
        top,
        width: `${POPOVER_WIDTH}px`,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px",
        borderRadius: "8px",
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 1000,
        color: "var(--color-text-primary)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        data-testid="link-action-address"
        title={href}
        style={{
          fontSize: "11px",
          lineHeight: 1.4,
          color: "var(--color-text-secondary)",
          padding: "0 4px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          userSelect: "text",
        }}
      >
        {href}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <button
          role="menuitem"
          onClick={handleCopy}
          aria-label={copied
            ? t("linkActions.copied", "Link copied")
            : t("linkActions.copy", "Copy link")}
          title={copied
            ? t("linkActions.copied", "Link copied")
            : t("linkActions.copy", "Copy link")}
          style={primaryButtonStyle}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? t("linkActions.copied", "Link copied") : t("linkActions.copy", "Copy link")}</span>
        </button>

        {canOpen && (
          <button
            role="menuitem"
            onClick={() => onOpen(href)}
            aria-label={t("linkActions.open", "Open link")}
            title={t("linkActions.open", "Open link")}
            style={secondaryButtonStyle}
          >
            <ExternalLink size={14} />
            <span>{t("linkActions.open", "Open link")}</span>
          </button>
        )}

        <button
          role="menuitem"
          onClick={onClose}
          aria-label={t("common.close", "Close")}
          title={t("common.close", "Close")}
          style={iconButtonStyle}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "5px",
  padding: "5px 9px",
  border: "none",
  borderRadius: "6px",
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const secondaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "5px",
  padding: "5px 9px",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  backgroundColor: "transparent",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  fontSize: "12px",
  whiteSpace: "nowrap",
};

const iconButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  marginLeft: "auto",
  padding: 0,
  border: "none",
  borderRadius: "6px",
  backgroundColor: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
