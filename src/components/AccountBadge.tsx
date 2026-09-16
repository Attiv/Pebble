import type { AccountBadgeInfo } from "@/lib/accountIdentity";

interface Props {
  badge: AccountBadgeInfo;
}

/**
 * Tells the reader which mailbox a row came from.
 *
 * The combined inbox mixes every account together, and a colour alone asks the
 * reader to memorise a legend — fine for two mailboxes, hopeless for eight. The
 * badge pairs that colour with the mailbox's name so the answer is readable
 * rather than recallable, and keeps the full address in the tooltip.
 *
 * The tint and border use the same `#rrggbb22` / `#rrggbb44` suffixes as the
 * label chips on the row below, so both kinds of pill read as one family.
 */
export default function AccountBadge({ badge }: Props) {
  return (
    <span
      data-testid="account-badge"
      title={badge.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        flexShrink: 0,
        maxWidth: "120px",
        padding: "0 6px",
        borderRadius: "8px",
        fontSize: "10.5px",
        fontWeight: 500,
        lineHeight: "16px",
        backgroundColor: `${badge.color}22`,
        border: `1px solid ${badge.color}44`,
        color: "var(--color-text-secondary)",
      }}
    >
      <span
        aria-hidden="true"
        data-testid="account-badge-dot"
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: badge.color,
          flexShrink: 0,
        }}
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {badge.label}
      </span>
    </span>
  );
}
