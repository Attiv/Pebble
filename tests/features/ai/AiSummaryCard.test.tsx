import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiSummaryCard from "../../../src/features/ai/AiSummaryCard";
import { aiSummarizeMessage } from "../../../src/lib/api";
import { profileLocalStorage } from "../../../src/lib/profileStorage";

const summarizeMock = vi.mocked(aiSummarizeMessage);

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../src/lib/api", () => ({
  aiSummarizeMessage: vi.fn(),
}));

const PRIVACY_ACK_KEY = "pebble-ai-privacy-ack";

describe("AiSummaryCard", () => {
  beforeEach(() => {
    localStorage.clear();
    summarizeMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("keeps the email on the device until the user accepts the privacy notice", async () => {
    render(<AiSummaryCard messageId="message-1" onClose={vi.fn()} />);

    expect(screen.getByText("ai.privacyNotice")).toBeTruthy();
    expect(summarizeMock).not.toHaveBeenCalled();

    summarizeMock.mockResolvedValue({ text: "- first point", engine: "ai" });
    fireEvent.click(screen.getByRole("button", { name: "translate.acceptAndContinue" }));

    await waitFor(() => {
      expect(summarizeMock).toHaveBeenCalledWith("message-1", expect.any(String));
    });
  });

  it("renders the summary the AI service returned", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    summarizeMock.mockResolvedValue({
      text: "Budget review.\n- deadline is Friday\n- Anna owns the numbers",
      engine: "ai",
    });

    render(<AiSummaryCard messageId="message-1" onClose={vi.fn()} />);

    expect(await screen.findByText(/Budget review\./)).toBeTruthy();
    expect(screen.getByText(/Anna owns the numbers/)).toBeTruthy();
  });

  it("copies the summary to the clipboard", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    summarizeMock.mockResolvedValue({ text: "Short summary", engine: "ai" });

    render(<AiSummaryCard messageId="message-1" onClose={vi.fn()} />);
    await screen.findByText("Short summary");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ai\.copy/ }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Short summary");
  });

  it("reports a failure without closing the card, and can retry", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    summarizeMock.mockRejectedValueOnce(new Error("AI service error 401"));

    render(<AiSummaryCard messageId="message-1" onClose={vi.fn()} />);

    expect(await screen.findByText("ai.summaryFailed")).toBeTruthy();
    expect(screen.getByText("AI service error 401")).toBeTruthy();

    summarizeMock.mockResolvedValueOnce({ text: "Recovered", engine: "ai" });
    fireEvent.click(screen.getByRole("button", { name: "ai.regenerate" }));

    expect(await screen.findByText("Recovered")).toBeTruthy();
  });

  it("re-requests the summary when the target language changes", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    summarizeMock.mockResolvedValue({ text: "Summary", engine: "ai" });

    render(<AiSummaryCard messageId="message-1" onClose={vi.fn()} />);
    await screen.findByText("Summary");

    const firstLang = summarizeMock.mock.calls[0][1];
    const otherLang = firstLang === "en" ? "fr" : "en";
    fireEvent.change(screen.getByLabelText("ai.summaryLanguage"), {
      target: { value: otherLang },
    });

    await waitFor(() => {
      expect(summarizeMock).toHaveBeenLastCalledWith("message-1", otherLang);
    });
  });

  it("closes from the close button", async () => {
    const onClose = vi.fn();
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    summarizeMock.mockResolvedValue({ text: "Summary", engine: "ai" });

    render(<AiSummaryCard messageId="message-1" onClose={onClose} />);
    await screen.findByText("Summary");
    fireEvent.click(screen.getByRole("button", { name: "ai.close" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
