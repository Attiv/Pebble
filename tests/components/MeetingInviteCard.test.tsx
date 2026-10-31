import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMessageMeetingInvite: vi.fn(),
  addMessageMeetingInviteToCalendar: vi.fn(),
  addToast: vi.fn(),
  openMessageLink: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: "en-US" },
  }),
}));

vi.mock("@/lib/api", () => ({
  getMessageMeetingInvite: mocks.getMessageMeetingInvite,
  addMessageMeetingInviteToCalendar: mocks.addMessageMeetingInviteToCalendar,
}));

vi.mock("@/lib/openMessageLink", () => ({
  openMessageLink: mocks.openMessageLink,
}));

vi.mock("@/stores/toast.store", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import MeetingInviteCard, {
  formatInviteRange,
} from "../../src/components/MeetingInviteCard";
import type { MeetingInvite } from "../../src/lib/api";

function invite(overrides: Partial<MeetingInvite> = {}): MeetingInvite {
  return {
    attachment_id: "attachment-1",
    summary: "Quarterly review",
    location: "Room 3B",
    organizer_name: "Wang Lei",
    organizer_email: "lk_wang@simplifiedtec.com",
    start: {
      utc_epoch: null,
      tzid: "China Standard Time",
      local: "2026-11-02T14:00:00",
      date_only: false,
    },
    end: {
      utc_epoch: null,
      tzid: "China Standard Time",
      local: "2026-11-02T15:30:00",
      date_only: false,
    },
    all_day: false,
    cancelled: false,
    recurring: false,
    sequence: 0,
    ...overrides,
  };
}

describe("MeetingInviteCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a message that is not an invitation", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(null);

    const { container } = render(<MeetingInviteCard messageId="message-1" />);

    await waitFor(() => expect(mocks.getMessageMeetingInvite).toHaveBeenCalledWith("message-1", false));
    expect(container.innerHTML).toBe("");
  });

  it("shows the meeting the invitation is proposing", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(invite());

    render(<MeetingInviteCard messageId="message-1" />);

    expect(await screen.findByText("Quarterly review")).toBeTruthy();
    expect(screen.getByText("Room 3B")).toBeTruthy();
    expect(screen.getByText("Wang Lei <lk_wang@simplifiedtec.com>")).toBeTruthy();
    // A TZID-anchored time is shown as that zone reads it, not converted to the
    // reader's own clock.
    expect(screen.getByText("Nov 2, 2026 14:00 – 15:30 (China Standard Time)")).toBeTruthy();
    expect(screen.getByText("Add to Calendar")).toBeTruthy();
  });

  it("keeps the event readable but offers no button once it is cancelled", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(
      invite({ cancelled: true, summary: "Quarterly review (cancelled)" }),
    );

    render(<MeetingInviteCard messageId="message-1" />);

    expect(await screen.findByText("Meeting cancelled")).toBeTruthy();
    expect(screen.queryByText("Add to Calendar")).toBeNull();
  });

  it("hands the invitation to the system calendar", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(invite());
    mocks.addMessageMeetingInviteToCalendar.mockResolvedValueOnce(undefined);

    render(<MeetingInviteCard messageId="message-1" />);
    fireEvent.click(await screen.findByText("Add to Calendar"));

    await waitFor(() =>
      expect(mocks.addMessageMeetingInviteToCalendar).toHaveBeenCalledWith("message-1"),
    );
    expect(mocks.addToast).toHaveBeenCalledWith({
      message: "Opened in your calendar",
      type: "success",
    });
  });

  it("reports a calendar that would not open instead of failing silently", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(invite());
    mocks.addMessageMeetingInviteToCalendar.mockRejectedValueOnce(new Error("no calendar"));

    render(<MeetingInviteCard messageId="message-1" />);
    fireEvent.click(await screen.findByText("Add to Calendar"));

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith({
        message: "Could not open your calendar",
        type: "error",
      }),
    );
  });

  it("explains an invitation that arrived as a link instead of a file", async () => {
    // Outlook can invite with an Outlook Web link; such a message carries no
    // calendar payload, so there is no button that could add anything.
    mocks.openMessageLink.mockResolvedValueOnce(undefined);
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(null);
    const body =
      'Microsoft Outlook Web Access: <a href="https://outlook.office365.com/owa/x.com/?itemid=AAMk&amp;exvsurl=1&amp;path=/calendar/item">open</a>';

    render(
      <MeetingInviteCard
        messageId="message-1"
        subject="Weekly Progress Meeting"
        hasAttachments={false}
        bodyHtml={body}
      />,
    );

    expect(await screen.findByText("Weekly Progress Meeting")).toBeTruthy();
    expect(screen.getByText(/arrived as an Outlook link/)).toBeTruthy();
    expect(screen.getByText(/iCalendar format/)).toBeTruthy();
    // Nothing pretended to be a calendar write.
    expect(screen.queryByText("Add to Calendar")).toBeNull();
    expect(mocks.getMessageMeetingInvite).toHaveBeenCalledWith("message-1", true);

    fireEvent.click(screen.getByText("Open in Outlook"));
    expect(mocks.openMessageLink).toHaveBeenCalledWith(
      "https://outlook.office365.com/owa/x.com/?itemid=AAMk&exvsurl=1&path=/calendar/item",
    );
  });

  it("loads an iCalendar invitation from the server when the cached mail is still link-only", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(invite({ attachment_id: null }));
    render(
      <MeetingInviteCard
        messageId="message-1"
        hasAttachments={false}
        bodyText="Microsoft Outlook Web Access: https://outlook.office365.com/owa/x.com/?itemid=AAMk&path=/calendar/item"
      />,
    );
    expect(await screen.findByText("Quarterly review")).toBeTruthy();
    expect(mocks.getMessageMeetingInvite).toHaveBeenCalledWith("message-1", true);
    expect(screen.getByText("Add to Calendar")).toBeTruthy();
    expect(mocks.addMessageMeetingInviteToCalendar).not.toHaveBeenCalled();
  });

  it("keeps the Outlook link usable if fetching the current invitation fails", async () => {
    mocks.getMessageMeetingInvite.mockRejectedValueOnce(new Error("IMAP unavailable"));
    render(<MeetingInviteCard messageId="message-1" hasAttachments={false}
      bodyText="https://outlook.office365.com/owa/x.com/?itemid=AAMk&path=/calendar/item" />);
    await waitFor(() => expect(mocks.getMessageMeetingInvite).toHaveBeenCalledWith("message-1", true));
    expect(screen.getByText("Open in Outlook")).toBeTruthy();
    expect(screen.queryByText("Add to Calendar")).toBeNull();
  });

  it("does not show a late server invitation after switching to another message", async () => {
    let resolve!: (value: MeetingInvite) => void;
    mocks.getMessageMeetingInvite.mockReturnValueOnce(new Promise<MeetingInvite>(r => { resolve = r; }));
    const { rerender, container } = render(<MeetingInviteCard messageId="message-1" hasAttachments={false}
      bodyText="https://outlook.office365.com/owa/x.com/?itemid=AAMk&path=/calendar/item" />);
    rerender(<MeetingInviteCard messageId="message-2" hasAttachments={false} bodyText="Lunch?" />);
    await act(async () => { resolve(invite()); });
    expect(container.innerHTML).toBe("");
  });

  it("stays out of the way when a mail is neither an invitation nor a link", async () => {
    const { container } = render(
      <MeetingInviteCard messageId="message-1" hasAttachments={false} bodyText="Lunch?" />,
    );

    expect(mocks.getMessageMeetingInvite).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("says so when the meeting repeats rather than pretending it is a one-off", async () => {
    mocks.getMessageMeetingInvite.mockResolvedValueOnce(invite({ recurring: true }));

    render(<MeetingInviteCard messageId="message-1" />);

    expect(await screen.findByText("Part of a repeating series")).toBeTruthy();
  });
});

describe("formatInviteRange", () => {
  it("renders an all-day event as a date with no clock", () => {
    const text = formatInviteRange(
      invite({
        start: { utc_epoch: null, tzid: null, local: "2026-12-25", date_only: true },
        end: null,
      }),
      "en-US",
    );

    expect(text).toContain("2026");
    expect(text).not.toMatch(/\d{2}:\d{2}/);
  });

  it("shows a UTC instant in the reader's own zone", () => {
    const text = formatInviteRange(
      invite({
        start: {
          utc_epoch: 1_793_167_200, // 2026-10-28T06:00:00Z
          tzid: null,
          local: "2026-10-28T06:00:00",
          date_only: false,
        },
        end: null,
      }),
      "en-US",
    );

    expect(text).toContain("2026");
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});
