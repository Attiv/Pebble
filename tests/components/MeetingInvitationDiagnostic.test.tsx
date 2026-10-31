import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../src/locales/en.json";
import type { InvitationDiagnostic } from "../../src/lib/api";
import MeetingInvitationDiagnostic from "../../src/components/MeetingInvitationDiagnostic";

const mocks = vi.hoisted(() => ({ check: vi.fn(), toast: vi.fn(), copy: vi.fn() }));
vi.mock("../../src/lib/api", () => ({ checkMeetingInvitation: mocks.check }));
vi.mock("../../src/stores/toast.store", () => ({
  useToastStore: { getState: () => ({ addToast: mocks.toast }) },
}));

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
});

function result(overrides: Partial<InvitationDiagnostic> = {}): InvitationDiagnostic {
  return {
    mime_types: ["text/plain"], calendar_parts: 0, methods: [], events: [],
    has_outlook_link: false, has_tnef: false, incomplete: false,
    ...overrides,
  };
}

function renderCheck(onClose = vi.fn()) {
  const client = new QueryClient();
  const view = (messageId: string) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeetingInvitationDiagnostic messageId={messageId} onClose={onClose} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return { ...render(view("selected-message")), view };
}

describe("meeting invitation diagnostic", () => {
  it("reads only the selected message and can close while waiting", () => {
    mocks.check.mockReturnValue(new Promise(() => {}));
    const close = vi.fn();
    renderCheck(close);
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith("selected-message");
    expect((screen.getByRole("button", { name: en.meetingCheck.copy }) as HTMLButtonElement).disabled).toBe(true);
    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.click(closeButton);
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows raw timezone fields and copies only the diagnostic summary", async () => {
    mocks.check.mockResolvedValue(result({
      mime_types: ["text/calendar"], calendar_parts: 1, methods: ["REQUEST"],
      events: [{ start: "DTSTART;TZID=Asia/Shanghai:20261103T140000", end: null, duration: "DURATION:PT1H" }],
    }));
    renderCheck();
    await screen.findByText(/DTSTART;TZID=Asia\/Shanghai/);
    expect(screen.getByRole("dialog").textContent).toContain("DURATION:PT1H");
    expect(screen.getByRole("dialog").textContent).toContain(en.meetingCheck.rawTimes);
    fireEvent.click(screen.getByRole("button", { name: en.meetingCheck.copy }));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
    expect(mocks.copy.mock.calls[0][0]).toContain("METHOD: REQUEST");
    expect(mocks.copy.mock.calls[0][0]).not.toContain("selected-message");
  });

  it("does not invent dates for Outlook links, and warns about uninspected TNEF", async () => {
    mocks.check.mockResolvedValue(result({ has_outlook_link: true, has_tnef: true, incomplete: true }));
    renderCheck();
    await screen.findByText(/Found an Outlook web link/);
    const text = screen.getByRole("dialog").textContent;
    expect(text).toContain(en.meetingCheck.tnef);
    expect(text).toContain(en.meetingCheck.incomplete);
    expect(text).not.toContain("DTSTART:");
  });

  it("reports a failure without automatic retry and allows an explicit retry", async () => {
    mocks.check.mockRejectedValueOnce({ message: "IMAP unavailable" }).mockResolvedValue(result());
    renderCheck();
    await screen.findByText(/IMAP unavailable/);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: en.meetingCheck.retry }));
    await screen.findByText(/No calendar data found/);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it("never shows a late result from a previously selected message", async () => {
    let resolveOld!: (value: InvitationDiagnostic) => void;
    mocks.check.mockReturnValueOnce(new Promise<InvitationDiagnostic>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(result({ has_outlook_link: true }));
    const { rerender, view } = renderCheck();
    rerender(view("next-message"));
    await screen.findByText(/Found an Outlook web link/);
    await act(async () => {
      resolveOld(result({ calendar_parts: 1, events: [{ start: "DTSTART:OLD", end: null, duration: null }] }));
    });
    expect(screen.getByRole("dialog").textContent).not.toContain("DTSTART:OLD");
    expect(mocks.check.mock.calls.map(([id]) => id)).toEqual(["selected-message", "next-message"]);
  });

  it("reports clipboard failures without losing the result", async () => {
    mocks.check.mockResolvedValue(result());
    mocks.copy.mockRejectedValue(new Error("Clipboard denied"));
    renderCheck();
    await screen.findByText(/No calendar data found/);
    fireEvent.click(screen.getByRole("button", { name: en.meetingCheck.copy }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: en.meetingCheck.copyFailed, type: "error" }));
    expect(screen.getByRole("dialog").textContent).toContain(en.meetingCheck.noCalendar);
  });
});
