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
export function useForwardCardLabels(): ForwardCardLabels {
  const { t } = useTranslation();

  return useMemo(() => ({
    badge: t("messageDetail.forwardedMessage", "Forwarded message"),
    quoted: t("messageDetail.quotedMessage", "Quoted message"),
    history: t("messageDetail.forwardedHistory", "Earlier message"),
    from: t("messageDetail.from", "From"),
    date: t("messageDetail.date", "Date"),
    to: t("messageDetail.to", "To"),
    cc: t("messageDetail.cc", "Cc"),
  }), [t]);
}
