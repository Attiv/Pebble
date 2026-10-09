import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRenderedHtml } from "@/lib/api";
import type { Message, RenderedHtml } from "@/lib/api";
import { defaultPrivacyMode } from "@/lib/privacyMode";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { openMessageLink } from "@/lib/openMessageLink";
import { useClickOutside } from "@/hooks/useClickOutside";
import { ShadowDomEmail, type MessageLinkContextMenuRequest } from "./ShadowDomEmail";
import LinkActionPopover from "./LinkActionPopover";
import ContactAddressAction from "./ContactAddressAction";
import { uniqueContactParticipants } from "./contact-participants";

interface Props {
  message: Message;
  defaultExpanded?: boolean;
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString([], {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ThreadMessageBubble({ message, defaultExpanded = false }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rendered, setRendered] = useState<RenderedHtml | null>(null);
  // A thread body is the same isolated renderer as the message detail, so
  // its links need the same way out.
  const [showLinkActions, setShowLinkActions] = useState<{ href: string; position: { x: number; y: number } } | null>(null);
  const linkActionsRef = useRef<HTMLDivElement>(null);
  const contactParticipants = uniqueContactParticipants(
    { name: message.from_name, address: message.from_address },
    message.to_list,
    message.cc_list,
  );

  useEffect(() => {
    if (expanded && !rendered) {
      getRenderedHtml(message.id, defaultPrivacyMode())
        .then((html) => setRendered({ ...html, html: sanitizeHtml(html.html) }))
        .catch((err) => console.warn("Failed to render thread message HTML", err));
    }
  }, [expanded, rendered, message.id]);

  useClickOutside(linkActionsRef, !!showLinkActions, () => setShowLinkActions(null));

  function handleLinkContextMenu(link: MessageLinkContextMenuRequest) {
    setShowLinkActions({ href: link.href, position: { x: link.x, y: link.y } });
  }

  function handleOpenMessageLink(href: string) {
    setShowLinkActions(null);
    void openMessageLink(href)
      .catch((err) => console.warn("Failed to open email body link", err));
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        marginBottom: "8px",
        overflow: "hidden",
        backgroundColor: "var(--color-bg)",
      }}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          cursor: "pointer",
          backgroundColor: expanded ? "var(--color-bg-hover)" : "transparent",
          border: "none",
          width: "100%",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ fontSize: "13px", fontWeight: 500, flex: 1 }}>
          {message.from_name || message.from_address}
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          {formatFullDate(message.date)}
        </span>
      </button>

      {/* Body - only when expanded */}
      {expanded && (
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--color-border)" }}>
          {/* To/Cc line */}
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "8px" }}>
            <div>
              {t("thread.to")} {message.to_list?.map((r: { address: string }) => r.address).join(", ")}
            </div>
            {message.cc_list?.length > 0 && (
              <div>
                {t("thread.cc", "Cc:")} {message.cc_list.map((r: { address: string }) => r.address).join(", ")}
              </div>
            )}
            <div
              aria-label={t("contacts.participantActions", "Contact actions")}
              style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "5px" }}
            >
              {contactParticipants.map((participant) => (
                <ContactAddressAction
                  key={participant.address.toLowerCase()}
                  accountId={message.account_id}
                  name={participant.name}
                  address={participant.address}
                />
              ))}
            </div>
          </div>
          {/* Body content */}
          {rendered?.html ? (
            <ShadowDomEmail html={rendered.html} onLinkContextMenu={handleLinkContextMenu} />
          ) : (
            <pre style={{
              fontSize: "13px", color: "var(--color-text-primary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              margin: 0, fontFamily: "inherit",
            }}>
              {message.body_text}
            </pre>
          )}
        </div>
      )}

      {showLinkActions && (
        <div ref={linkActionsRef}>
          <LinkActionPopover
            href={showLinkActions.href}
            position={showLinkActions.position}
            onOpen={handleOpenMessageLink}
            onClose={() => setShowLinkActions(null)}
          />
        </div>
      )}
    </div>
  );
}
