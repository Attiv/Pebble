import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { checkMeetingInvitation } from "@/lib/api";
import { extractErrorMessage } from "@/lib/extractErrorMessage";
import { useToastStore } from "@/stores/toast.store";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  messageId: string;
  onClose: () => void;
}

export default function MeetingInvitationDiagnostic({ messageId, onClose }: Props) {
  const { t } = useTranslation();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["meeting-invitation-diagnostic", messageId],
    queryFn: () => checkMeetingInvitation(messageId),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const lines: string[] = [];
  if (data) {
    lines.push(
      t("meetingCheck.readOnly"),
      `${t("meetingCheck.mimeTypes")}: ${data.mime_types.join(", ")}`,
      t("meetingCheck.calendarParts", { count: data.calendar_parts }),
    );
    if (data.methods.length) lines.push(`METHOD: ${data.methods.join(", ")}`);
    if (data.calendar_parts === 0) {
      lines.push(t(data.has_outlook_link ? "meetingCheck.outlookLinkOnly" : "meetingCheck.noCalendar"));
    } else {
      lines.push(t("meetingCheck.rawTimes"));
      if (data.events.length === 0) lines.push(t("meetingCheck.noEvents"));
      data.events.forEach((event, index) => {
        lines.push(`#${index + 1}`, event.start ?? t("meetingCheck.missingStart"));
        if (event.end) lines.push(event.end);
        if (event.duration) lines.push(event.duration);
        if (!event.end && !event.duration) lines.push(t("meetingCheck.missingEnd"));
      });
    }
    if (data.has_tnef) lines.push(t("meetingCheck.tnef"));
    if (data.incomplete) lines.push(t("meetingCheck.incomplete"));
  }
  const report = lines.join("\n\n");

  async function handleConfirm() {
    if (error) {
      void refetch();
      return;
    }
    try {
      await navigator.clipboard.writeText(report);
      useToastStore.getState().addToast({ message: t("meetingCheck.copied"), type: "success" });
    } catch {
      useToastStore.getState().addToast({ message: t("meetingCheck.copyFailed"), type: "error" });
    }
  }

  return (
    <ConfirmDialog
      title={t("meetingCheck.title")}
      message={isFetching ? t("meetingCheck.loading") : error
        ? t("meetingCheck.failed", { error: extractErrorMessage(error) }) : report}
      confirmLabel={t(error ? "meetingCheck.retry" : "meetingCheck.copy")}
      confirmDisabled={isFetching || (!data && !error)}
      scrollable
      cancelLabel={t("common.close", "Close")}
      onCancel={onClose}
      onConfirm={handleConfirm}
    />
  );
}
