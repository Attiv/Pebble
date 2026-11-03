import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ForwardCardLabels } from "@/lib/forwardCard";

/**
 * The copy a rebuilt forward card needs, in the current language.
 *
 * `ShadowDomEmail` renders inside a shadow root and has no translation context
 * of its own, so the labels travel in as data. The identity is memoised on `t`
 * because the component keys its render effect on the label content.
 */
/** `messageDetail.to`/`cc` are the recipient-row labels and carry a colon
 * ("To:", "收件人：") because that row reads as prose. The card prints the
 * label in its own column, so the colon is dropped here rather than the
 * shared key being forked in two. */
function bare(value: string): string {
  return value.replace(/\s*[:：]\s*$/, "");
}

export function useForwardCardLabels(): ForwardCardLabels {
  const { t } = useTranslation();

  return useMemo(() => ({
    badge: t("messageDetail.forwardedMessage", "Forwarded message"),
    quoted: t("messageDetail.quotedMessage", "Quoted message"),
    history: t("messageDetail.forwardedHistory", "Earlier message"),
    from: bare(t("messageDetail.from", "From")),
    date: bare(t("messageDetail.date", "Date")),
    to: bare(t("messageDetail.to", "To")),
    cc: bare(t("messageDetail.cc", "Cc")),
  }), [t]);
}
