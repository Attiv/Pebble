import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import MarkAllReadButton from "./MarkAllReadButton";
import { accountLabel, accountOptionLabel } from "../lib/accountIdentity";
import { unreadCountForAccount } from "../hooks/queries/useAccountUnreadCounts";
import { ALL_ACCOUNTS_SELECT_VALUE } from "../lib/folderAggregation";
import type { Account } from "../lib/api";

interface Props {
  accounts: Account[];
  /** `null` means the combined "all accounts" mailbox. */
  activeAccountId: string | null;
  /** Unread mail per account, keyed by account id. */
  unreadCounts: Record<string, number>;
  collapsed: boolean;
  /** Mirrors the "show unread count badges in sidebar" setting. */
  showUnread: boolean;
  /** `null` selects the combined mailbox. */
  onSelect: (accountId: string | null) => void;
}

const AVATAR_SIZE = 22;

function initialOf(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function avatarStyle(isActive: boolean, collapsed: boolean): React.CSSProperties {
  return {
    width: collapsed ? 26 : AVATAR_SIZE,
    height: collapsed ? 26 : AVATAR_SIZE,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: collapsed ? 11 : 10,
    fontWeight: 700,
    backgroundColor: isActive
      ? "color-mix(in srgb, var(--color-accent) 22%, transparent)"
      : "color-mix(in srgb, var(--color-text-secondary) 14%, transparent)",
    color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
  };
}

function badgeStyle(isActive: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 600,
    minWidth: "16px",
    textAlign: "right",
    color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
  };
}

/**
 * The account picker in the sidebar.
 *
 * Every configured mailbox is listed at once — with its own unread count — so
 * accounts can be told apart and switched between without opening a dropdown.
 * Rows for accounts that carry a custom label show the label and the address on
 * two lines; unlabelled accounts show the address alone. The selected row also
 * carries the mark-all-read action, because that work belongs to one mailbox and
 * has no meaning for the combined view.
 */
export default function SidebarAccountList({
  accounts,
  activeAccountId,
  unreadCounts,
  collapsed,
  showUnread,
  onSelect,
}: Props) {
  const { t } = useTranslation();

  // The sentinel is what the old `<select>` posted for the combined mailbox;
  // the store normally holds `null` for it, so accept both.
  const allSelected = !activeAccountId || activeAccountId === ALL_ACCOUNTS_SELECT_VALUE;
  const showAllRow = accounts.length > 1;
  const totalUnread = accounts.reduce(
    (sum, account) => sum + unreadCountForAccount(unreadCounts, account.id),
    0,
  );

  function rowStyle(isActive: boolean): React.CSSProperties {
    return {
      display: "flex",
      alignItems: "center",
      gap: "2px",
      borderRadius: "6px",
      backgroundColor: isActive ? "var(--color-sidebar-active)" : "transparent",
    };
  }

  function selectButtonStyle(isActive: boolean): React.CSSProperties {
    return {
      flex: 1,
      minWidth: 0,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: collapsed ? "5px" : "5px 8px",
      justifyContent: collapsed ? "center" : "flex-start",
      border: "none",
      borderRadius: "6px",
      backgroundColor: isActive ? "var(--color-sidebar-active)" : "transparent",
      color: "var(--color-text-primary)",
      fontSize: "12.5px",
      textAlign: "left",
      cursor: "pointer",
      transition: "background-color 0.15s ease",
    };
  }

  function handleSelect(accountId: string | null) {
    onSelect(accountId);
  }

  return (
    <div
      className="scroll-region"
      data-testid="account-list"
      role="group"
      aria-label={t("settings.emailAccounts", "Email Accounts")}
      style={{
        padding: collapsed ? "0 6px 6px" : "0 10px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        maxHeight: "34vh",
        overflowY: "auto",
      }}
    >
      {showAllRow && (
        <div
          data-testid="account-row-all"
          style={rowStyle(allSelected)}
          onMouseEnter={(e) => {
            if (!allSelected) e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
          }}
          onMouseLeave={(e) => {
            if (!allSelected) e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <button
            type="button"
            onClick={() => handleSelect(null)}
            aria-current={allSelected ? "true" : undefined}
            aria-label={t("sidebar.allAccounts", "All accounts")}
            title={collapsed ? t("sidebar.allAccounts", "All accounts") : undefined}
            style={selectButtonStyle(allSelected)}
          >
            <span style={avatarStyle(allSelected, collapsed)} aria-hidden="true">
              <Layers size={collapsed ? 14 : 12} />
            </span>
            {!collapsed && (
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t("sidebar.allAccounts", "All accounts")}
              </span>
            )}
            {!collapsed && showUnread && totalUnread > 0 && (
              <span data-testid="account-unread-all" style={badgeStyle(allSelected)}>
                {totalUnread}
              </span>
            )}
          </button>
        </div>
      )}

      {accounts.map((account) => {
        const isActive = !allSelected && account.id === activeAccountId;
        const unread = unreadCountForAccount(unreadCounts, account.id);
        const label = accountLabel(account);
        // Only repeat the address on a second line when it differs from the label.
        const secondary = account.account_label?.trim() ? account.email : null;
        const full = accountOptionLabel(account);

        return (
          <div
            key={account.id}
            data-testid={`account-row-${account.id}`}
            style={rowStyle(isActive)}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <button
              type="button"
              onClick={() => handleSelect(account.id)}
              aria-current={isActive ? "true" : undefined}
              aria-label={collapsed ? full : undefined}
              title={collapsed ? full : undefined}
              style={selectButtonStyle(isActive)}
            >
              <span style={avatarStyle(isActive, collapsed)} aria-hidden="true">
                {initialOf(label)}
              </span>
              {!collapsed && (
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                  <span
                    title={full}
                    style={{
                      fontSize: "12.5px",
                      fontWeight: isActive ? 600 : 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                  {secondary && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--color-text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {secondary}
                    </span>
                  )}
                </span>
              )}
              {!collapsed && showUnread && unread > 0 && (
                <span data-testid={`account-unread-${account.id}`} style={badgeStyle(isActive)}>
                  {unread}
                </span>
              )}
            </button>
            {/* Rendered even at zero unread so the action stays discoverable; the
                button disables itself. It is absent for the combined mailbox,
                where "mark all read" has no single target. */}
            {!collapsed && isActive && (
              <MarkAllReadButton accountId={account.id} accountLabel={full} unread={unread} />
            )}
          </div>
        );
      })}
    </div>
  );
}
