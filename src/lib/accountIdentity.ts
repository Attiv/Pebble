import type { Account } from "./ipc-types";
import { assignAccountColors, getAccountColor } from "./accountColors";

export function accountLabel(account: Account): string {
  return account.account_label?.trim() || account.email;
}

export function accountOptionLabel(account: Account): string {
  const label = account.account_label?.trim();
  return label ? `${label} · ${account.email}` : account.email;
}

export function senderIdentityLabel(account: Account): string {
  const name = (account.provider === "outlook" ? account.provider_display_name : account.display_name)?.trim();
  return name ? `${name} <${account.email}>` : account.email;
}

function localPart(email: string | null | undefined): string {
  const [local] = (email ?? "").split("@");
  return local?.trim() ?? "";
}

/**
 * Short handle for a mailbox, for places where only a few characters fit.
 *
 * The user's own label wins, because that is the name they chose and recognise.
 * Without one it falls back to the local part of the address — `work@example.com`
 * reads as `work` — unless two mailboxes share that local part, where only the
 * full address stays unambiguous.
 */
export function accountShortLabel(account: Account, allAccounts: Account[] = []): string {
  const label = account.account_label?.trim();
  if (label) return label;

  const local = localPart(account.email);
  if (!local) return account.email?.trim() || "";

  const collides = allAccounts.some(
    (other) => other.id !== account.id && localPart(other.email) === local,
  );
  return collides ? account.email : local;
}

/** Everything a message or thread row needs to label the mailbox it came from. */
export interface AccountBadgeInfo {
  /** Accent colour shared with the sidebar picker. */
  color: string;
  /** Short name rendered on the row. */
  label: string;
  /** Full identity, revealed on hover. */
  title: string;
}

/**
 * Builds the per-account badge lookup the mail lists render.
 *
 * Colours come from {@link assignAccountColors} so mailboxes stay visually
 * distinct from each other and match the sidebar. The whole map is built once
 * per account list rather than per row, since a row only ever needs its own
 * entry.
 */
export function accountBadges(accounts: Account[]): Map<string, AccountBadgeInfo> {
  const colors = assignAccountColors(accounts);
  const badges = new Map<string, AccountBadgeInfo>();

  for (const account of accounts) {
    // Rows are matched by account id, so an account without one can never be
    // labelled.
    if (!account.id) continue;

    badges.set(account.id, {
      color: colors.get(account.id) ?? getAccountColor(account, account.id),
      label: accountShortLabel(account, accounts),
      title: accountOptionLabel(account),
    });
  }

  return badges;
}
