import { describe, expect, it } from "vitest";
import { findOutlookInviteLink } from "../../src/lib/outlookInviteLink";

// The plain-text body of a real link-only invitation, kept verbatim down to the
// long `itemid` and the two links that must *not* match.
const LEADING_TEXT = `
Microsoft Outlook Web Access: https://outlook.office365.com/owa/simplifiedtec.com/?itemid=AAMkAGM3OTE2N2ZhLWM3N2ItNGRmZC1iNWIzLTgxYTBmMTEwNmYwMwBGAAAAAAAMUnW8XsXSTbhn8es%2BZYjMBwBxmdZwkS19RZU1il%2B6w4lQAAAAAAENAABxmdZwkS19RZU1il%2B6w4lQAAHKZ7enAAA%3D&exvsurl=1&path=/calendar/item

To receive meeting invitations as .iCalendar attachments instead of Outlook Web App links, go to https://outlook.office365.com/owa/simplifiedtec.com/?path=/options/popandimap and select Send meeting invitations in iCalendar format.

Weekly Progress Meeting
`;

const INVITE_URL =
  "https://outlook.office365.com/owa/simplifiedtec.com/?itemid=" +
  "AAMkAGM3OTE2N2ZhLWM3N2ItNGRmZC1iNWIzLTgxYTBmMTEwNmYwMwBGAAAAAAAMUnW8XsXSTbhn8es%2BZYjMBwBxmdZwkS19RZU1il%2B6w4lQAAAAAAENAABxmdZwkS19RZU1il%2B6w4lQAAHKZ7enAAA%3D" +
  "&exvsurl=1&path=/calendar/item";

describe("findOutlookInviteLink", () => {
  it("finds the calendar item a link-only invitation points at", () => {
    expect(findOutlookInviteLink(LEADING_TEXT)).toBe(INVITE_URL);
  });

  it("reads the link out of the HTML body, entities and all", () => {
    const html = `<p>Microsoft Outlook Web Access: <a href="https://outlook.office365.com/owa/simplifiedtec.com/?itemid=AAMkAGM3OTE2&amp;exvsurl=1&amp;path=/calendar/item">open</a></p>`;

    expect(findOutlookInviteLink(html)).toContain("path=/calendar/item");
    expect(findOutlookInviteLink(html)).not.toContain("&amp;");
  });

  it("falls back to the other body when the first has nothing", () => {
    expect(findOutlookInviteLink(undefined, "", LEADING_TEXT)).toBe(INVITE_URL);
  });

  it("ignores the settings link the same mail carries", () => {
    const settingsOnly =
      "go to https://outlook.office365.com/owa/simplifiedtec.com/?path=/options/popandimap and select it";

    expect(findOutlookInviteLink(settingsOnly)).toBeNull();
  });

  it("ignores a calendar item hosted somewhere else", () => {
    expect(
      findOutlookInviteLink("https://intranet.example.com/owa/?path=/calendar/item"),
    ).toBeNull();
  });

  it("leaves ordinary mail alone", () => {
    expect(findOutlookInviteLink("<p>Lunch tomorrow?</p>", "Lunch tomorrow?")).toBeNull();
    expect(findOutlookInviteLink(undefined, null)).toBeNull();
  });
});
