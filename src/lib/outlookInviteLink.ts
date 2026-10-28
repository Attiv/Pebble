/**
 * The invitation that Outlook sends as a link.
 *
 * Outlook can be configured to invite people with an Outlook Web App link
 * instead of an attached iCalendar file, and a message sent that way carries no
 * calendar data at all — only an `itemid` URL back to the sender's mailbox, plus
 * a line telling the reader how to change the setting. Nothing can be read out
 * of such a message and nothing can be handed to a calendar, but it is
 * recognisable, and saying so where the reader expects an invitation is better
 * than showing them nothing and leaving them to wonder.
 *
 * The test is deliberately narrow — a Microsoft-hosted mailbox and a
 * `/calendar/item` path — because a false positive puts a meeting card on an
 * ordinary mail that merely links to a calendar.
 */

const OUTLOOK_HOSTS = ["outlook.office365.com", "outlook.office.com", "outlook.live.com"];

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

function decodeEntities(url: string): string {
  return url
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
}

function isOutlookHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return OUTLOOK_HOSTS.includes(host);
}

/**
 * The first link to an Outlook calendar item in any of `sources`, or `null`.
 *
 * Both the HTML and the plain-text body are worth searching: the HTML holds the
 * link as an `href`, while a sender that writes plain text leaves the URL bare —
 * and the two can disagree about which one survived the trip.
 */
export function findOutlookInviteLink(
  ...sources: Array<string | null | undefined>
): string | null {
  for (const source of sources) {
    if (!source) continue;

    for (const match of source.matchAll(URL_PATTERN)) {
      const url = decodeEntities(match[0]);

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }

      if (!isOutlookHost(parsed.hostname)) continue;
      // `path=/calendar/item` is the marker, and some senders encode the
      // slashes, so the query is unescaped before it is looked at.
      if (!parsed.search.replace(/%2F/gi, "/").includes("/calendar/item")) continue;

      return url;
    }
  }

  return null;
}
