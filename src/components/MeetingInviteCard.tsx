import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  CalendarPlus,
  CalendarX,
  Clock,
  ExternalLink,
  Loader,
  MapPin,
  Repeat,
  User,
} from "lucide-react";
import { addMessageMeetingInviteToCalendar, getMessageMeetingInvite } from "@/lib/api";
import type { MeetingInvite, MeetingInviteTime } from "@/lib/api";
import { openMessageLink } from "@/lib/openMessageLink";
import { findOutlookInviteLink } from "@/lib/outlookInviteLink";
import { useToastStore } from "@/stores/toast.store";

interface Props {
  messageId: string;
  /** Subjects the link-only card; a mail with a real invitation brings its own. */
  subject?: string;
  /**
   * Skip ordinary attachment-free mail; Outlook links may need fresh server data.
   */
  hasAttachments?: boolean;
  bodyHtml?: string | null;
  bodyText?: string | null;
}

interface Moment {
  dateText: string;
  clock: string | null;
  /** The zone named by the sender, when there was one. */
  zone: string | null;
}

/**
 * Describe one end of a meeting.
 *
 * Three shapes arrive, and they mean different things. A `Z` value is an
 * instant, so it is rendered in the reader's own zone. A `TZID` value says what
 * the clock in that zone reads, which is not the same as the reader's clock —
 * converting it would silently move the meeting, so the zone is named instead.
 * A date-only value has no time at all.
 */
function describeMoment(time: MeetingInviteTime, locale: string): Moment {
  if (time.utc_epoch !== null) {
    const instant = new Date(time.utc_epoch * 1000);
    return {
      dateText: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(instant),
      clock: time.date_only
        ? null
        : new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(instant),
      zone: null,
    };
  }

  const [datePart, timePart = ""] = time.local.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const dateText = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(year, (month || 1) - 1, day || 1),
  );
  if (time.date_only) {
    return { dateText, clock: null, zone: time.tzid };
  }
  const [hour = "00", minute = "00"] = timePart.split(":");
  return { dateText, clock: `${hour}:${minute}`, zone: time.tzid };
}

function renderMoment(moment: Moment, fallbackZone: string | null): string {
  const parts = [moment.dateText];
  if (moment.clock) parts.push(moment.clock);
  const zone = moment.zone ?? fallbackZone;
  return zone ? `${parts.join(" ")} (${zone})` : parts.join(" ");
}

/** Format one end of a meeting for display. */
export function formatInviteMoment(time: MeetingInviteTime, locale: string): string {
  return renderMoment(describeMoment(time, locale), time.tzid);
}

/**
 * The whole span. Two ends that fall on the same day in the same zone are shown
 * once — `Nov 2, 2026 14:00 – 15:30 (China Standard Time)` — because repeating
 * the date and the zone twice is noise, not precision.
 */
export function formatInviteRange(invite: MeetingInvite, locale: string): string | null {
  if (!invite.start) return null;

  const start = describeMoment(invite.start, locale);
  if (!invite.end) return renderMoment(start, invite.start.tzid);

  const end = describeMoment(invite.end, locale);
  const zone = invite.start.tzid ?? invite.end.tzid;
  const sameDay = start.dateText === end.dateText;
  const sameZone = (invite.start.tzid ?? null) === (invite.end.tzid ?? null);

  if (sameDay && sameZone && start.clock && end.clock) {
    const clock = `${start.clock} – ${end.clock}`;
    return zone ? `${start.dateText} ${clock} (${zone})` : `${start.dateText} ${clock}`;
  }
  return `${renderMoment(start, invite.start.tzid)} – ${renderMoment(end, invite.end.tzid)}`;
}

/**
 * The meeting an invitation is proposing, shown above the mail body.
 *
 * Renders nothing unless the message really is an invitation, so a plain mail
 * pays only the cost of one local query. Adding it hands the `.ics` to the
 * system calendar rather than keeping a copy here: the calendar owns the
 * meeting, and a second copy inside Pebble could only disagree with it.
 *
 * An old Outlook-link message may gain a calendar payload after changing IMAP
 * retrieval settings; fetch it on demand without rewriting the local message.
 */
export default function MeetingInviteCard({
  messageId,
  subject = "",
  hasAttachments = true,
  bodyHtml,
  bodyText,
}: Props) {
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const [invite, setInvite] = useState<MeetingInvite | null>(null);
  const [adding, setAdding] = useState(false);
  const linkOnlyUrl = useMemo(
    () => findOutlookInviteLink(bodyHtml, bodyText),
    [bodyHtml, bodyText],
  );

  useEffect(() => {
    let cancelled = false;
    setInvite(null);
    if (!hasAttachments && !linkOnlyUrl) return;

    void (async () => {
      try {
        const result = await getMessageMeetingInvite(messageId, !!linkOnlyUrl);
        if (!cancelled) setInvite(result);
      } catch {
        // An unreadable invitation is not an error worth a toast: the mail
        // itself is still there to read.
        if (!cancelled) setInvite(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messageId, hasAttachments, linkOnlyUrl]);

  if (!invite && !linkOnlyUrl) return null;

  // Keep the link usable while the server payload is pending or unavailable.
  if (!invite) {
    return (
      <section
        className="meeting-invite-card"
        data-link-only="true"
        data-testid="meeting-invite-card"
        aria-label={t("calendar.invite", "Meeting invitation")}
      >
        <div className="meeting-invite-card__icon" aria-hidden="true">
          <CalendarDays size={18} />
        </div>

        <div className="meeting-invite-card__body">
          <div className="meeting-invite-card__label">
            {t("calendar.invite", "Meeting invitation")}
          </div>
          <div className="meeting-invite-card__title">
            {subject || t("calendar.untitled", "Untitled meeting")}
          </div>
          <div className="meeting-invite-card__meta">
            <Clock size={13} aria-hidden="true" />
            <span>
              {t(
                "calendar.linkOnly",
                "This invitation arrived as an Outlook link. Calendar data has not been loaded yet.",
              )}
            </span>
          </div>
          <div className="meeting-invite-card__meta meeting-invite-card__hint">
            <span>
              {t(
                "calendar.linkOnlyHint",
                "In Outlook, turn on “Send meeting invitations in iCalendar format”, then reopen this mail so Pebble can retrieve the invitation.",
              )}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="meeting-invite-card__action"
          onClick={() => void openMessageLink(linkOnlyUrl!)}
        >
          <ExternalLink size={14} />
          <span>{t("calendar.openInOutlook", "Open in Outlook")}</span>
        </button>
      </section>
    );
  }

  const when = formatInviteRange(invite, i18n.language);
  const organizer = invite.organizer_name
    ? invite.organizer_email
      ? `${invite.organizer_name} <${invite.organizer_email}>`
      : invite.organizer_name
    : invite.organizer_email;

  async function handleAdd() {
    setAdding(true);
    try {
      await addMessageMeetingInviteToCalendar(messageId);
      addToast({
        message: t("calendar.opened", "Opened in your calendar"),
        type: "success",
      });
    } catch {
      addToast({
        message: t("calendar.openFailed", "Could not open your calendar"),
        type: "error",
      });
    } finally {
      setAdding(false);
    }
  }

  return (
    <section
      className="meeting-invite-card"
      data-cancelled={invite.cancelled ? "true" : "false"}
      data-testid="meeting-invite-card"
      aria-label={t("calendar.invite", "Meeting invitation")}
    >
      <div className="meeting-invite-card__icon" aria-hidden="true">
        {invite.cancelled ? <CalendarX size={18} /> : <CalendarDays size={18} />}
      </div>

      <div className="meeting-invite-card__body">
        <div className="meeting-invite-card__label">
          {invite.cancelled
            ? t("calendar.cancelled", "Meeting cancelled")
            : t("calendar.invite", "Meeting invitation")}
        </div>
        <div className="meeting-invite-card__title">
          {invite.summary || t("calendar.untitled", "Untitled meeting")}
        </div>

        {when && (
          <div className="meeting-invite-card__meta">
            <Clock size={13} aria-hidden="true" />
            <span>{when}</span>
          </div>
        )}
        {invite.location && (
          <div className="meeting-invite-card__meta">
            <MapPin size={13} aria-hidden="true" />
            <span>{invite.location}</span>
          </div>
        )}
        {organizer && (
          <div className="meeting-invite-card__meta">
            <User size={13} aria-hidden="true" />
            <span>{organizer}</span>
          </div>
        )}
        {invite.recurring && (
          <div className="meeting-invite-card__meta">
            <Repeat size={13} aria-hidden="true" />
            <span>{t("calendar.repeats", "Part of a repeating series")}</span>
          </div>
        )}
      </div>

      {!invite.cancelled && (
        <button
          type="button"
          className="meeting-invite-card__action"
          onClick={handleAdd}
          disabled={adding}
        >
          {adding ? <Loader size={14} className="spinner" /> : <CalendarPlus size={14} />}
          <span>{t("calendar.add", "Add to Calendar")}</span>
        </button>
      )}
    </section>
  );
}
