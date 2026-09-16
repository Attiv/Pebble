import { useEffect, useMemo } from "react";
import {
  Inbox,
  Send,
  FileEdit,
  Trash2,
  Archive,
  AlertTriangle,
  Folder,
  LayoutGrid,
  Settings,
  Search,
  Clock,
  Star,
  ContactRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../stores/ui.store";
import type { ActiveView } from "../stores/ui.store";
import { isComposeDirty, useComposeStore } from "../stores/compose.store";
import { useConfirmStore } from "../stores/confirm.store";
import { useMailStore } from "../stores/mail.store";
import { useAccountsQuery, useFoldersForAccountsQuery } from "../hooks/queries";
import { useFolderUnreadCountsForAccounts } from "../hooks/queries/useFolderUnreadCounts";
import { useAccountUnreadCounts } from "../hooks/queries/useAccountUnreadCounts";
import SidebarAccountList from "./SidebarAccountList";
import {
  buildAllAccountsFolders,
  sortFoldersForSidebar,
  unreadCountForFolder,
} from "../lib/folderAggregation";
import type { Account, Folder as FolderType } from "../lib/api";

const EMPTY_ACCOUNTS: Account[] = [];
const EMPTY_FOLDERS: FolderType[] = [];

const ROLE_ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox size={16} />,
  sent: <Send size={16} />,
  drafts: <FileEdit size={16} />,
  trash: <Trash2 size={16} />,
  archive: <Archive size={16} />,
  spam: <AlertTriangle size={16} />,
};

function folderIcon(role: FolderType["role"]): React.ReactNode {
  return (role && ROLE_ICONS[role]) || <Folder size={16} />;
}

// Default folders shown when no account is configured
const DEFAULT_FOLDERS: { role: string; labelKey: string }[] = [
  { role: "inbox", labelKey: "sidebar.inbox" },
  { role: "sent", labelKey: "sidebar.sent" },
  { role: "archive", labelKey: "sidebar.archive" },
  { role: "drafts", labelKey: "sidebar.drafts" },
  { role: "trash", labelKey: "sidebar.trash" },
  { role: "spam", labelKey: "sidebar.spam" },
];

/**
 * Views that show nothing about a particular mailbox. Selecting an account while
 * one of these is open has to move back to the mail view, otherwise the click
 * appears to do nothing.
 */
const MAILBOX_AGNOSTIC_VIEWS: ActiveView[] = ["settings", "contacts"];

export default function Sidebar() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const activeFolderId = useMailStore((s) => s.activeFolderId);
  const activeAccountId = useMailStore((s) => s.activeAccountId);
  const setActiveAccountId = useMailStore((s) => s.setActiveAccountId);
  const setActiveFolderId = useMailStore((s) => s.setActiveFolderId);

  const showUnread = useUIStore((s) => s.showFolderUnreadCount);
  const { data: accounts = EMPTY_ACCOUNTS } = useAccountsQuery();
  const allAccountsMode = accounts.length > 1 && !activeAccountId;
  const folderAccountIds = useMemo(
    () => activeAccountId ? [activeAccountId] : accounts.map((account) => account.id),
    [accounts, activeAccountId],
  );
  const { data: folders = EMPTY_FOLDERS } = useFoldersForAccountsQuery(folderAccountIds);
  const { data: unreadCounts = {} } = useFolderUnreadCountsForAccounts(folderAccountIds);
  const accountUnreadCounts = useAccountUnreadCounts();
  const ROLE_LABELS: Record<string, string> = {
    inbox: t("sidebar.inbox"),
    sent: t("sidebar.sent"),
    drafts: t("sidebar.drafts"),
    trash: t("sidebar.trash"),
    archive: t("sidebar.archive"),
    spam: t("sidebar.spam"),
  };
  const folderLabel = (folder: FolderType) => (folder.role && ROLE_LABELS[folder.role]) || folder.name;

  const displayedFolders = useMemo(
    () => allAccountsMode ? buildAllAccountsFolders(folders) : folders,
    [allAccountsMode, folders],
  );
  const hasRealFolders = displayedFolders.length > 0;

  // Keep system folders stable across all-account and single-account views.
  const dedupedFolders = useMemo(() => {
    return sortFoldersForSidebar(displayedFolders);
  }, [displayedFolders]);

  // Auto-select the only account. With multiple accounts, null means the
  // combined "all accounts" mailbox.
  useEffect(() => {
    if (accounts.length === 1 && !activeAccountId) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  // Auto-select inbox folder when folders load.
  //
  // A mailbox with no folders is left selected on purpose. The previous version
  // advanced to the next account, which made any account whose first sync had not
  // finished impossible to select at all: clicking it bounced the selection away.
  // InboxView shows a sync prompt for that case instead.
  useEffect(() => {
    if (displayedFolders.length > 0 && !activeFolderId) {
      const inbox = displayedFolders.find((f) => f.role === "inbox");
      setActiveFolderId((inbox ?? displayedFolders[0]).id);
    }
  }, [displayedFolders, activeFolderId, setActiveFolderId]);

  async function confirmDiscardDraft() {
    if (isComposeDirty()) {
      const confirmed = await useConfirmStore.getState().confirm({
        title: t("compose.discardDraft", "Discard draft"),
        message: t("compose.discardDraftConfirm", "You have an unsaved draft. Discard and leave?"),
        destructive: true,
      });
      return confirmed;
    }
    return true;
  }

  async function safeSetActiveView(view: Parameters<typeof setActiveView>[0]) {
    if (isComposeDirty()) {
      const confirmed = await confirmDiscardDraft();
      if (!confirmed) return;
      useComposeStore.getState().discardComposeAndSetActiveView(view);
      return;
    }
    setActiveView(view);
  }

  async function handleFolderClick(folderId: string) {
    if (isComposeDirty()) {
      const confirmed = await confirmDiscardDraft();
      if (!confirmed) return;
      useComposeStore.getState().discardComposeAndSetActiveView("inbox");
      setActiveFolderId(folderId);
      return;
    }
    setActiveView("inbox");
    setActiveFolderId(folderId);
  }

  async function handleAccountSelect(accountId: string | null) {
    if (isComposeDirty()) {
      const confirmed = await confirmDiscardDraft();
      if (!confirmed) return;
      useComposeStore.getState().discardComposeAndSetActiveView("inbox");
      setActiveAccountId(accountId);
      return;
    }
    // Settings and Contacts are not tied to a mailbox, so staying on them after
    // picking a different account looks like the click did nothing. The mail
    // views (inbox, starred, search, snoozed, kanban) already follow the
    // selected account, so those are left alone.
    if (MAILBOX_AGNOSTIC_VIEWS.includes(activeView)) {
      setActiveView("inbox");
    }
    setActiveAccountId(accountId);
  }

  const buttonBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderRadius: "6px",
    padding: sidebarCollapsed ? "7px" : "6px 10px",
    width: "100%",
    border: "none",
    cursor: "pointer",
    fontSize: "13px",
    textAlign: "left",
    justifyContent: sidebarCollapsed ? "center" : "flex-start",
  };

  return (
    <aside
      aria-label={t("sidebar.navigation", "Sidebar")}
      style={{
        width: sidebarCollapsed ? "48px" : "200px",
        flexShrink: 0,
        backgroundColor: "var(--color-sidebar-bg)",
        borderRight: "1px solid var(--color-border)",
        transition: "width 150ms ease",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Search button */}
      <nav aria-label={t("sidebar.search", "Search")} style={{ padding: "8px 6px 0", display: "flex", flexDirection: "column", gap: "1px" }}>
        <SidebarButton
          icon={<Search size={16} />}
          label={t("search.title", "Search")}
          isActive={activeView === "search"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("search")}
        />
      </nav>

      {/* Section label */}
      {!sidebarCollapsed && (
        <div style={{
          padding: "12px 10px 4px 10px",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {t("sidebar.mail", "Mail")}
        </div>
      )}

      {/* Account list. Every mailbox is listed at once, with its own unread
          count, so accounts can be told apart and switched between at a glance.
          The mark-all-read action rides on the selected row, because clearing a
          mailbox only has a target when one account is selected. */}
      {accounts.length > 0 && (
        <SidebarAccountList
          accounts={accounts}
          activeAccountId={activeAccountId}
          unreadCounts={accountUnreadCounts}
          collapsed={sidebarCollapsed}
          showUnread={showUnread}
          onSelect={handleAccountSelect}
        />
      )}

      {/* Folders section */}
      <nav
        className="scroll-region sidebar-folder-scroll"
        aria-label={t("sidebar.mailFolders", "Mail folders")}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 6px",
          display: "flex",
          flexDirection: "column",
          gap: "1px",
        }}
      >
        {hasRealFolders
          ? dedupedFolders.flatMap((folder) => {
              const items: React.ReactNode[] = [];
              if (folder.role === "drafts") {
                items.push(
                  <SidebarButton
                    key="__starred__"
                    icon={<Star size={16} />}
                    label={t("sidebar.starred", "Starred")}
                    isActive={activeView === "starred"}
                    collapsed={sidebarCollapsed}
                    style={buttonBase}
                    onClick={() => safeSetActiveView("starred")}
                  />
                );
              }
              const isActive = folder.id === activeFolderId && activeView === "inbox";
              items.push(
                <SidebarButton
                  key={folder.id}
                  icon={folderIcon(folder.role)}
                  label={folderLabel(folder)}
                  badge={showUnread ? unreadCountForFolder(folder.id, folders, unreadCounts) : undefined}
                  isActive={isActive}
                  collapsed={sidebarCollapsed}
                  style={buttonBase}
                  onClick={() => handleFolderClick(folder.id)}
                />
              );
              return items;
            })
          : DEFAULT_FOLDERS.flatMap((df, index) => {
              const items: React.ReactNode[] = [];
              if (df.role === "drafts") {
                items.push(
                  <SidebarButton
                    key="__starred__"
                    icon={<Star size={16} />}
                    label={t("sidebar.starred", "Starred")}
                    isActive={activeView === "starred"}
                    collapsed={sidebarCollapsed}
                    style={buttonBase}
                    onClick={() => safeSetActiveView("starred")}
                  />
                );
              }
              items.push(
                <SidebarButton
                  key={df.role}
                  icon={ROLE_ICONS[df.role] || <Folder size={16} />}
                  label={t(df.labelKey)}
                  isActive={index === 0 && activeView === "inbox"}
                  collapsed={sidebarCollapsed}
                  style={buttonBase}
                  onClick={() => safeSetActiveView("inbox")}
                />
              );
              return items;
            })}
      </nav>

      {/* Divider */}
      <div
        style={{
          height: "1px",
          backgroundColor: "var(--color-border)",
          margin: "0 6px",
        }}
      />

      {/* Bottom nav: Contacts + Snoozed + Kanban + Settings */}
      <nav
        aria-label={t("sidebar.tools", "Tools")}
        style={{
          padding: "6px 6px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "1px",
        }}
      >
        <SidebarButton
          icon={<ContactRound size={16} />}
          label={t("sidebar.contacts", "Contacts")}
          isActive={activeView === "contacts"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("contacts")}
        />
        <SidebarButton
          icon={<Clock size={16} />}
          label={t("sidebar.snoozed", "Snoozed")}
          isActive={activeView === "snoozed"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("snoozed")}
        />
        <SidebarButton
          icon={<LayoutGrid size={16} />}
          label={t("sidebar.kanban", "Kanban")}
          isActive={activeView === "kanban"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("kanban")}
        />
        <SidebarButton
          icon={<Settings size={16} />}
          label={t("sidebar.settings", "Settings")}
          isActive={activeView === "settings"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("settings")}
        />
      </nav>
    </aside>
  );
}

// Reusable sidebar button to avoid repetitive hover logic
function SidebarButton({
  icon, label, badge, isActive, collapsed, style, disabled, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  isActive: boolean;
  collapsed: boolean;
  style: React.CSSProperties;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      aria-current={isActive ? "page" : undefined}
      title={collapsed ? label : undefined}
      disabled={disabled}
      style={{
        ...style,
        backgroundColor: isActive
          ? "var(--color-sidebar-active)"
          : style.backgroundColor ?? "transparent",
        color: style.color ?? "var(--color-text-primary)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        transition: "background-color 0.15s ease, opacity 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!isActive && !style.backgroundColor)
          e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive && !style.backgroundColor)
          e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {icon}
      {!collapsed && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {label}
        </span>
      )}
      {!collapsed && badge != null && badge > 0 && (
        <span style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-accent)",
          minWidth: "18px",
          textAlign: "right",
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}
