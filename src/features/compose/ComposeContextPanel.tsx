import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@/lib/ipc-types";
import { buildReplyContextBodyHtml } from "@/hooks/useComposeEditor";

function formatAddress(name: string | null | undefined, address: string): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} <${address}>` : address;
}

function formatRecipientList(list: Message["to_list"]): string {
  return list
    .map((entry) => formatAddress(entry.name, entry.address))
    .filter(Boolean)
    .join(", ");
}

function formatMessageDate(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  return new Date(seconds * 1000).toLocaleString();
}

/**
 * The message being replied to, kept visible above the editor for the whole
 * reply. It is derived from the message snapshot rather than from editor
 * content, so switching between Rich Text / Markdown / HTML never hides or
 * mutates it.
 */
export function ComposeReplyContext({ message }: { message: Message }) {
  const { t } = useTranslation();
  const bodyHtml = useMemo(
    () => buildReplyContextBodyHtml(message, t("compose.forwardedHistory", "Earlier message")),
    [message, t],
  );

  const from = formatAddress(message.from_name, message.from_address);
  const date = formatMessageDate(message.date);
  const to = formatRecipientList(message.to_list);
  const cc = formatRecipientList(message.cc_list);
  const metaLines = [
    t("compose.forwardedFrom", { sender: from }),
    date ? t("compose.forwardedDate", { date }) : "",
    to ? t("compose.forwardedTo", { recipients: to }) : "",
    cc ? t("compose.forwardedCc", { recipients: cc }) : "",
  ].filter(Boolean);

  return (
    <section
      className="compose-context-card"
      aria-label={t("compose.originalMessage", "Original message")}
    >
      <div className="compose-context-card__header">
        <span className="compose-context-badge">
          {t("compose.originalMessage", "Original message")}
        </span>
        {message.subject ? (
          <div className="compose-context-subject">{message.subject}</div>
        ) : null}
        {metaLines.map((line) => (
          <div key={line} className="compose-context-meta">{line}</div>
        ))}
      </div>
      <div
        className="compose-context-body scroll-region"
        dir="auto"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
    </section>
  );
}

/**
 * The forwarded message card. The generated markup already carries the header
 * (label, subject, sender, date, recipients) and nested `.pebble-forward-history`
 * blocks, so the card itself is the "latest" level in the hierarchy.
 */
export function ComposeForwardContext({ html }: { html: string }) {
  const { t } = useTranslation();
  if (!html) return null;

  return (
    <div
      className="compose-forward-context"
      aria-label={t("compose.forwardedMessage", "Forwarded message")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
