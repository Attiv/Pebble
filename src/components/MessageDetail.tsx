import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Clock, Languages, Palette, Sparkles } from "lucide-react";
import { trustSender } from "@/lib/api";
import { useTranslation } from "react-i18next";
import type { PrivacyMode, TranslateResult } from "@/lib/api";
import { useClickOutside } from "@/hooks/useClickOutside";
import { MessageDetailSkeleton } from "./Skeleton";
import PrivacyBanner from "./PrivacyBanner";
import AttachmentList from "./AttachmentList";
import SnoozePopover from "../features/inbox/SnoozePopover";
import { ShadowDomEmail } from "./ShadowDomEmail";
import TranslatePopover from "../features/translate/TranslatePopover";
import BilingualView from "../features/translate/BilingualView";
import AiSummaryCard from "../features/ai/AiSummaryCard";
import MessageActionToolbar from "./MessageActionToolbar";
import { useMessageLoader } from "@/hooks/useMessageLoader";
import { useBilingualTranslation } from "@/hooks/useBilingualTranslation";
import type { BilingualError } from "@/hooks/useBilingualTranslation";
import { defaultPrivacyMode } from "@/lib/privacyMode";
import { getMessageTheme, messageThemeVariables, senderInitials } from "@/lib/messageThemes";
import { useKanbanStore } from "@/stores/kanban.store";
import { useToastStore } from "@/stores/toast.store";
import { useUIStore } from "@/stores/ui.store";
import SelectionActionPopover from "./SelectionActionPopover";
import MessageThemePicker from "./MessageThemePicker";
import type { EmailAddress } from "@/lib/api";
import ContactAddressAction from "./ContactAddressAction";
import { uniqueContactParticipants } from "./contact-participants";

interface Props {
  messageId: string;
  onBack: () => void;
  folderRole?: string | null;
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRecipient(address: EmailAddress): string {
  const name = address.name?.trim();
  const email = address.address.trim();
  if (name && email) return `${name} <${email}>`;
  if (email) return `<${email}>`;
  return name ?? "";
}

function formatRecipients(addresses: EmailAddress[]): string {
  return addresses.map(formatRecipient).filter(Boolean).join(", ");
}

export default function MessageDetail({ messageId, onBack, folderRole }: Props) {
  const { t } = useTranslation();
  // The message-detail template is a stored preference, not local state, so
  // switching it in one message carries over to the next one.
  const messageThemeId = useUIStore((s) => s.messageTheme);
  const setMessageTheme = useUIStore((s) => s.setMessageTheme);
  const theme = getMessageTheme(messageThemeId);
  const [privacyOverride, setPrivacyOverride] = useState<{
    messageId: string;
    mode: PrivacyMode;
  }>(() => ({ messageId, mode: defaultPrivacyMode() }));
  const privacyMode = privacyOverride.messageId === messageId
    ? privacyOverride.mode
    : defaultPrivacyMode();
  const [showSnooze, setShowSnooze] = useState(false);
  const [showSelectionActions, setShowSelectionActions] = useState<{ text: string; position: { x: number; y: number } } | null>(null);
  const [showTranslate, setShowTranslate] = useState<{ text: string; position: { x: number; y: number } } | null>(null);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);

  const snoozeRef = useRef<HTMLDivElement>(null);
  const selectionActionsRef = useRef<HTMLDivElement>(null);
  const translateRef = useRef<HTMLDivElement>(null);
  const themePickerRef = useRef<HTMLDivElement>(null);

  const { message, setMessage, rendered, loading, error } = useMessageLoader(messageId, privacyMode);
  const {
    bilingualMode,
    bilingualResult,
    bilingualLoading,
    bilingualError,
    bilingualWarning,
    handleBilingualToggle,
    resetBilingual,
  } = useBilingualTranslation(messageId, rendered, message);

  useClickOutside(snoozeRef, showSnooze, () => setShowSnooze(false));
  useClickOutside(selectionActionsRef, !!showSelectionActions, () => setShowSelectionActions(null));
  useClickOutside(translateRef, !!showTranslate, () => setShowTranslate(null));
  useClickOutside(themePickerRef, showThemePicker, () => setShowThemePicker(false));

  // Reset bilingual state when messageId changes
  useEffect(() => {
    setPrivacyOverride({ messageId, mode: defaultPrivacyMode() });
    resetBilingual();
    setShowAiSummary(false);
  }, [messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLoadImages() {
    setPrivacyOverride({ messageId, mode: "LoadOnce" });
  }

  async function handleTrustSender(trustType: "images" | "all") {
    if (message) {
      try {
        await trustSender(message.account_id, message.from_address, trustType);
        // "images" only widens this render to LoadOnce; the backend re-reads the
        // persisted trust level and can raise it later. "all" asks for full
        // trust, which the backend confirms against the stored row before
        // letting trackers load.
        setPrivacyOverride({
          messageId,
          mode: trustType === "all"
            ? { TrustedSender: message.from_address }
            : "LoadOnce",
        });
      } catch (err) {
        console.error("Failed to persist trusted sender:", err);
      }
    }
  }

  function getCurrentSelectedText() {
    const selection = window.getSelection();
    return selection?.toString().trim() || "";
  }

  function getCurrentSelectionPosition() {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    const x = rect && rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect && rect.height > 0 ? rect.bottom : window.innerHeight / 2;
    return { x, y };
  }

  function openSelectionActionsForSelection(position?: { x: number; y: number }, selectedText = getCurrentSelectedText()) {
    if (selectedText.length <= 5) return false;
    setShowTranslate(null);
    setShowSelectionActions({
      text: selectedText,
      position: position ?? getCurrentSelectionPosition(),
    });
    return true;
  }

  function openTranslateForSelection(position?: { x: number; y: number }) {
    const selectedText = getCurrentSelectedText();
    if (selectedText.length <= 5) return;
    setShowSelectionActions(null);
    setShowTranslate({ text: selectedText, position: position ?? getCurrentSelectionPosition() });
  }

  function handleTranslateSelectedText(text: string, position: { x: number; y: number }) {
    setShowSelectionActions(null);
    setShowTranslate({ text, position });
  }

  function handleSearchSelectedText(text: string) {
    useUIStore.getState().setSearchQuery(text);
    useUIStore.getState().setActiveView("search");
    setShowSelectionActions(null);
  }

  function handleCreateRuleFromSelection(text: string) {
    const ui = useUIStore.getState();
    ui.setPendingRuleDraftText(text);
    ui.setSettingsTab("rules");
    ui.setActiveView("settings");
    setShowSelectionActions(null);
  }

  async function handleAddSelectionToKanbanNote(text: string) {
    setShowSelectionActions(null);
    try {
      const kanban = useKanbanStore.getState();
      if (!kanban.cardIdSet.has(messageId)) {
        await kanban.addCard(messageId, "todo");
      }
      await useKanbanStore.getState().setContextNote(messageId, text);
      useUIStore.getState().setActiveView("kanban");
      useToastStore.getState().addToast({
        message: t("kanban.contextNoteAdded", "Added selected text to Kanban note"),
        type: "success",
      });
    } catch {
      useToastStore.getState().addToast({
        message: t("kanban.contextNoteFailed", "Failed to add Kanban note"),
        type: "error",
      });
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    const selectedText = getCurrentSelectedText();
    if (selectedText.length <= 5) return;
    e.preventDefault();
    openSelectionActionsForSelection({ x: e.clientX, y: e.clientY }, selectedText);
  }

  /**
   * Say which way the translation failed. "The engine answered but the answer is
   * unusable" used to be invisible — the untranslated body was rendered as if it
   * were the translation — so each of those cases now names itself.
   */
  function bilingualErrorReason(error: BilingualError | null): string {
    switch (error?.code) {
      case "empty":
        return t(
          "common.translationEmpty",
          "The translation service returned no text. Check the engine configuration in Settings.",
        );
      case "unchanged":
        return t(
          "common.translationUnchanged",
          "The translation service returned the original text unchanged. The message may already be in the target language, or the model is not translating.",
        );
      case "noText":
        return t("common.translationNoText", "This message has no body text to translate.");
      default: {
        const failed = t("common.translationFailed", "Translation failed");
        return error?.detail ? `${failed}: ${error.detail}` : failed;
      }
    }
  }

  useEffect(() => {
    const onTranslate = () => openTranslateForSelection();
    const onBilingual = () => handleBilingualToggle();
    const onSummarize = () => setShowAiSummary((visible) => !visible);
    document.addEventListener("pebble:translate-selection", onTranslate);
    document.addEventListener("pebble:toggle-bilingual", onBilingual);
    document.addEventListener("pebble:ai-summarize", onSummarize);
    return () => {
      document.removeEventListener("pebble:translate-selection", onTranslate);
      document.removeEventListener("pebble:toggle-bilingual", onBilingual);
      document.removeEventListener("pebble:ai-summarize", onSummarize);
    };
  });

  if (loading) {
    return <MessageDetailSkeleton />;
  }

  if (error) {
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-error, #dc2626)",
          fontSize: "14px",
          padding: "24px",
          textAlign: "center",
        }}
      >
        {t("common.messageLoadFailed", "Failed to load message")}: {error}
      </div>
    );
  }

  if (!message) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-text-secondary)",
          fontSize: "14px",
        }}
      >
        {t("common.messageNotFound", "Message not found")}
      </div>
    );
  }

  const recipientLine = formatRecipients(message.to_list);
  const ccLine = formatRecipients(message.cc_list);
  const contactParticipants = uniqueContactParticipants(
    { name: message.from_name, address: message.from_address },
    message.to_list,
    message.cc_list,
  );

  /* ── Theme layout ───────────────────────────────────────────────────────────
   * Every structural decision comes from `theme.layout`; nothing below branches
   * on a theme id. `data-msg-*` tells the stylesheet which grid template to use,
   * and the `--msg-*` variables carry the measurements.
   */
  const layout = theme.layout;
  const inColumns = layout.structure === "columns";
  const toolbarInSidebar = layout.toolbar === "sidebar";

  const backButton = (
    <button
      className="message-detail-back"
      onClick={onBack}
      aria-label={t("compose.back", "Back")}
    >
      <ArrowLeft size={18} />
    </button>
  );

  const headerActions = (
    <div className="message-detail-actions">
      <div ref={snoozeRef} className="message-detail-action-slot">
        <button
          className="message-detail-icon-button"
          onClick={() => setShowSnooze(!showSnooze)}
          aria-pressed={showSnooze}
          title={t("messageActions.snooze", "Snooze message")}
          aria-label={t("messageActions.snooze", "Snooze message")}
        >
          <Clock size={16} />
        </button>
        {showSnooze && (
          <SnoozePopover
            messageId={messageId}
            onClose={() => setShowSnooze(false)}
            onSnoozed={() => {
              setShowSnooze(false);
              onBack();
            }}
          />
        )}
      </div>
      <div ref={themePickerRef} className="message-detail-action-slot">
        <button
          className="message-detail-icon-button"
          onClick={() => setShowThemePicker((visible) => !visible)}
          aria-pressed={showThemePicker}
          aria-haspopup="dialog"
          title={t("messageThemes.picker", "Message theme")}
          aria-label={t("messageThemes.picker", "Message theme")}
        >
          <Palette size={16} />
        </button>
        {showThemePicker && (
          <MessageThemePicker activeTheme={messageThemeId} onSelect={setMessageTheme} />
        )}
      </div>
      <button
        className="message-detail-icon-button"
        onClick={handleBilingualToggle}
        aria-pressed={bilingualMode}
        title={t("messageActions.bilingualView", "Toggle bilingual view")}
        aria-label={t("messageActions.bilingualView", "Toggle bilingual view")}
      >
        <Languages size={16} />
      </button>
      <button
        className="message-detail-icon-button"
        onClick={() => setShowAiSummary((visible) => !visible)}
        aria-pressed={showAiSummary}
        title={t("ai.summarize")}
        aria-label={t("ai.summarize")}
      >
        <Sparkles size={16} />
      </button>
    </div>
  );

  // Kept as one node so header and sidebar share the exact same markup — only
  // the surrounding grid container differs.
  const avatarNode = layout.avatar ? (
    <span className="message-detail-avatar" aria-hidden="true">
      {senderInitials(message.from_name, message.from_address)}
    </span>
  ) : null;

  const identityNode = (
    <div className="message-detail-identity">
      <div className="message-detail-from">
        <span className="message-detail-from-name">
          {message.from_name || message.from_address}
        </span>
        {message.from_name && (
          <span className="message-detail-from-address">&lt;{message.from_address}&gt;</span>
        )}
      </div>
      {(recipientLine || ccLine) && (
        <div className="message-detail-recipients">
          {recipientLine && (
            <span>
              {t("messageDetail.to", "To:")}&nbsp;{recipientLine}
            </span>
          )}
          {ccLine && (
            <span>
              {t("messageDetail.cc", "Cc:")}&nbsp;{ccLine}
            </span>
          )}
        </div>
      )}
      <div
        className="message-detail-contacts"
        aria-label={t("contacts.participantActions", "Contact actions")}
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
      <div className="message-detail-date">{formatFullDate(message.date)}</div>
    </div>
  );

  const actionToolbar = (
    <div className="message-detail-toolbar">
      <MessageActionToolbar
        message={message}
        folderRole={folderRole}
        onBack={onBack}
        onMessageUpdate={setMessage}
        orientation={toolbarInSidebar ? "vertical" : "horizontal"}
      />
    </div>
  );

  const attachmentNode = message.has_attachments ? (
    <AttachmentList messageId={message.id} variant={inColumns ? "panel" : "bar"} />
  ) : null;

  return (
    <div
      className="message-detail-container"
      data-message-theme={theme.id}
      data-msg-structure={layout.structure}
      data-msg-align={layout.align}
      data-msg-toolbar={layout.toolbar}
      data-msg-header-card={layout.headerCard ? "true" : "false"}
      data-msg-avatar={layout.avatar ? "true" : "false"}
      data-msg-full-bleed={layout.headerFullBleed ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        // The page colour lives in the stylesheet (`.message-detail-container`)
        // so a custom app wallpaper can still win over it.
        ...messageThemeVariables(theme),
      }}
    >
      {/* Header — subject, sender identity and the action toolbar */}
      <div className="message-detail-header">
        <div className="message-detail-header-inner">
          {/* `display: contents` promotes these three into the header grid, so the
              back button, subject and icon cluster can be placed by template. */}
          <div className="message-detail-topbar">
            {backButton}
            <h2 className="message-detail-title">
              {message.subject || t("inbox.noSubject", "(no subject)")}
            </h2>
            {headerActions}
          </div>
          {!inColumns && avatarNode}
          {!inColumns && identityNode}
          {!inColumns && !toolbarInSidebar && actionToolbar}
        </div>
      </div>

      {/* Body — one column, or a details sidebar plus the reading column */}
      <div className="message-detail-body-area">
        {inColumns && (
          <aside className="message-detail-aside">
            {avatarNode}
            {identityNode}
            {actionToolbar}
            {attachmentNode}
          </aside>
        )}

        <div className="message-detail-reading">
          {/* Privacy Banner */}
          {rendered && (
            <PrivacyBanner
              rendered={rendered}
              onLoadImages={handleLoadImages}
              onTrustSender={handleTrustSender}
            />
          )}

          {/* AI summary — sits outside the body so reading it can never alter the mail */}
          {showAiSummary && (
            <AiSummaryCard messageId={messageId} onClose={() => setShowAiSummary(false)} />
          )}

          <div
            className="scroll-region message-body-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("messageDetail.body", "Message body")}
            style={{
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "var(--msg-page-padding)",
            }}
            onContextMenu={handleContextMenu}
          >
            <div
              className="message-body-surface"
              style={{
                width: "100%",
                maxWidth: "var(--msg-content-width)",
                boxSizing: "border-box",
                background: "var(--msg-surface-background)",
                border: "var(--msg-surface-border)",
                borderRadius: "var(--msg-surface-radius)",
                boxShadow: "var(--msg-surface-shadow)",
                padding: "var(--msg-surface-padding)",
              }}
            >
              {bilingualMode && bilingualLoading ? (
                <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{t("common.translating", "Translating...")}</div>
              ) : bilingualMode && bilingualResult ? (
                <>
                  {bilingualWarning && (
                    <div
                      role="status"
                      style={{
                        fontSize: "12px",
                        color: "var(--color-warning, #e67e22)",
                        marginBottom: "10px",
                      }}
                    >
                      {t(
                        "common.translationIncomplete",
                        "Some content could not be translated ({{done}}/{{total}}).",
                        { done: bilingualWarning.done, total: bilingualWarning.total },
                      )}
                    </div>
                  )}
                  {(bilingualResult as TranslateResult & { _isHtml?: boolean })._isHtml ? (
                    <ShadowDomEmail html={bilingualResult.translated} theme={theme} />
                  ) : (
                    <BilingualView segments={bilingualResult.segments ?? []} />
                  )}
                </>
              ) : bilingualMode ? (
                <>
                  <div
                    role="alert"
                    style={{
                      fontSize: "12px",
                      lineHeight: 1.5,
                      color: "var(--color-error, #dc2626)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      marginBottom: "12px",
                    }}
                  >
                    {bilingualErrorReason(bilingualError)}
                  </div>
                  {/* The mail itself stays readable — a failed translation must not hide it. */}
                  {rendered && rendered.html ? (
                    <ShadowDomEmail html={rendered.html} theme={theme} />
                  ) : (
                    <pre
                      className="message-body-text"
                      style={{
                        fontSize: "var(--msg-body-size)",
                        lineHeight: "var(--msg-body-line-height)" as CSSProperties["lineHeight"],
                        color: "var(--msg-body-color)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        margin: 0,
                        fontFamily: "var(--msg-body-font)",
                      }}
                    >
                      {message.body_text}
                    </pre>
                  )}
                </>
              ) : rendered && rendered.html ? (
                <ShadowDomEmail html={rendered.html} theme={theme} />
              ) : (
                <pre
                  className="message-body-text"
                  style={{
                    fontSize: "var(--msg-body-size)",
                    lineHeight: "var(--msg-body-line-height)" as CSSProperties["lineHeight"],
                    color: "var(--msg-body-color)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    fontFamily: "var(--msg-body-font)",
                  }}
                >
                  {message.body_text}
                </pre>
              )}
            </div>
          </div>

          {/* Attachments — a footer bar in one column, a sidebar panel in two */}
          {!inColumns && attachmentNode}
        </div>
      </div>

      {showTranslate && (
        <div ref={translateRef}>
          <TranslatePopover
            text={showTranslate.text}
            position={showTranslate.position}
            onClose={() => setShowTranslate(null)}
          />
        </div>
      )}

      {showSelectionActions && (
        <div ref={selectionActionsRef}>
          <SelectionActionPopover
            text={showSelectionActions.text}
            position={showSelectionActions.position}
            onTranslate={handleTranslateSelectedText}
            onSearch={handleSearchSelectedText}
            onCreateRule={handleCreateRuleFromSelection}
            onAddToKanbanNote={handleAddSelectionToKanbanNote}
            onClose={() => setShowSelectionActions(null)}
          />
        </div>
      )}
    </div>
  );
}
