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

const AVATAR_SIZE = 24;

/** Counts above this read as `99+`, so the pill never grows past two digits. */
const BADGE_CAP = 99;

function initialOf(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function formatUnread(count: number): string {
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
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

/**
 * Wraps an avatar so the unread badge can be pinned to its corner without
 * taking part in the row's layout — a badge that reserves space would push the
 * address sideways every time mail arrives.
 */
function avatarStackStyle(): React.CSSProperties {
  return { position: "relative", display: "inline-flex", flexShrink: 0 };
}

/**
 * The unread count, as a pill on the avatar.
 *
 * A bare number at the far end of the row reads as one more trailing control
 * next to the mark-all-read action, and it disappears completely when the
 * sidebar is collapsed — which is when a mailbox's state is hardest to read any
 * other way. Pinning the count to the avatar keeps it attached to the mailbox
 * it belongs to at both widths.
 *
 * The 3px offset lets the pill overlap the avatar's corner while staying inside
 * the row's own padding, so the list keeps its current row spacing and nothing
 * clips against the row above.
 */
function unreadBadgeStyle(): React.CSSProperties {
  return {
    position: "absolute",
    top: "-3px",
    left: "-3px",
    minWidth: "14px",
    height: "14px",
    padding: "0 4px",
    boxSizing: "border-box",
    borderRadius: "7px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--color-accent)",
    color: "#ffffff",
    fontSize: "9.5px",
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
  };
}

/**
 * The count is hidden from assistive tech on purpose: the row's own accessible
 * name already spells out "3 unread", so announcing the pill as well would say
 * the same thing twice.
 */
function UnreadBadge({
  count,
  testId,
  title,
}: {
  count: number;
  testId: string;
  title: string;
}) {
  return (
    <span data-testid={testId} title={title} aria-hidden="true" style={unreadBadgeStyle()}>
      {formatUnread(count)}
    </span>
  );
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

  /**
   * Collapsed rows lose their label, so the accessible name is the only place a
   * reader can learn how much mail is waiting. The badge itself is decorative.
   */
  function accessibleLabelOf(label: string, unreadText: string | null): string {
    return unreadText ? `${label} · ${unreadText}` : label;
  }

  function handleSelect(accountId: string | null) {
    onSelect(accountId);
  }

  const allUnreadText = showUnread && totalUnread > 0
    ? t("sidebar.unreadCount", "{{count}} unread", { count: totalUnread })
    : null;
  const allLabel = accessibleLabelOf(t("sidebar.allAccounts", "All accounts"), allUnreadText);

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
            aria-label={collapsed ? allLabel : undefined}
            title={collapsed ? allLabel : undefined}
            style={selectButtonStyle(allSelected)}
          >
            <span style={avatarStackStyle()}>
              <span style={avatarStyle(allSelected, collapsed)} aria-hidden="true">
                <Layers size={collapsed ? 14 : 12} />
              </span>
              {allUnreadText && (
                <UnreadBadge
                  count={totalUnread}
                  testId="account-unread-all"
                  title={allUnreadText}
                />
              )}
            </span>
            {!collapsed && (
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t("sidebar.allAccounts", "All accounts")}
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
        const unreadText = showUnread && unread > 0
          ? t("sidebar.unreadCount", "{{count}} unread", { count: unread })
          : null;

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
              aria-label={collapsed ? accessibleLabelOf(full, unreadText) : undefined}
              title={collapsed ? accessibleLabelOf(full, unreadText) : undefined}
              style={selectButtonStyle(isActive)}
            >
              <span style={avatarStackStyle()}>
                <span style={avatarStyle(isActive, collapsed)} aria-hidden="true">
                  {initialOf(label)}
                </span>
                {unreadText && (
                  <UnreadBadge
                    count={unread}
                    testId={`account-unread-${account.id}`}
                    title={unreadText}
                  />
                )}
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
