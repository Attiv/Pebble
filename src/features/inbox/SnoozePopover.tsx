import { useState } from "react";
import { useTranslation } from "react-i18next";
import { snoozeMessage } from "@/lib/api";
import { useUIStore } from "@/stores/ui.store";

interface Props {
  messageId: string;
  onClose: () => void;
  onSnoozed: () => void;
}

function getPresets(t: (key: string, fallback: string) => string): { label: string; getTimestamp: () => number }[] {
  return [
    {
      label: t("snooze.oneHour", "1 hour"),
      getTimestamp: () => Math.floor(Date.now() / 1000) + 3600,
    },
    {
      label: t("snooze.tonight", "Tonight (8 PM)"),
      getTimestamp: () => {
        const d = new Date();
        d.setHours(20, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return Math.floor(d.getTime() / 1000);
      },
    },
    {
      label: t("snooze.tomorrow", "Tomorrow (9 AM)"),
      getTimestamp: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return Math.floor(d.getTime() / 1000);
      },
    },
    {
      label: t("snooze.nextMonday", "Next Monday (9 AM)"),
      getTimestamp: () => {
        const d = new Date();
        const day = d.getDay();
        const daysUntilMonday = day === 0 ? 1 : 8 - day;
        d.setDate(d.getDate() + daysUntilMonday);
        d.setHours(9, 0, 0, 0);
        return Math.floor(d.getTime() / 1000);
      },
    },
  ];
}

export default function SnoozePopover({ messageId, onClose, onSnoozed }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleSnooze(getTimestamp: () => number) {
    setLoading(true);
    try {
      const returnTo = useUIStore.getState().activeView;
      await snoozeMessage(messageId, getTimestamp(), returnTo);
      onSnoozed();
    } catch (err) {
      console.error("Snooze failed:", err);
      setError(true);
      setTimeout(() => {
        setError(false);
        onClose();
      }, 2000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={t("snooze.until", "Snooze until...")}
      className="pebble-popover-enter pebble-popover-enter--top-right"
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: "4px",
        backgroundColor: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: "4px 0",
        zIndex: 100,
        minWidth: "200px",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {t("snooze.until", "Snooze until...")}
      </div>
      {getPresets(t).map((preset) => (
        <button
          key={preset.label}
          disabled={loading}
          onClick={() => handleSnooze(preset.getTimestamp)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "8px 12px",
            border: "none",
            background: "none",
            cursor: loading ? "wait" : "pointer",
            fontSize: "13px",
            color: "var(--color-text-primary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor =
              "var(--color-bg-hover, rgba(0,0,0,0.05))")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "transparent")
          }
        >
          {preset.label}
        </button>
      ))}
      {error && (
        <div role="alert" aria-live="assertive" style={{
          padding: "6px 10px",
          fontSize: "12px",
          color: "#ef4444",
          textAlign: "center",
        }}>
          {t("snooze.failed", "Snooze failed")}
        </div>
      )}
    </div>
  );
}
