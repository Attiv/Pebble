import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ComposeAiAssistant from "../../../src/features/ai/ComposeAiAssistant";
import { aiHelpWrite, aiPolish, aiProofread, aiTranslate } from "../../../src/lib/api";
import { profileLocalStorage } from "../../../src/lib/profileStorage";

const polishMock = vi.mocked(aiPolish);
const proofreadMock = vi.mocked(aiProofread);
const translateMock = vi.mocked(aiTranslate);
const helpWriteMock = vi.mocked(aiHelpWrite);

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
  aiPolish: vi.fn(),
  aiProofread: vi.fn(),
  aiTranslate: vi.fn(),
  aiHelpWrite: vi.fn(),
}));

const PRIVACY_ACK_KEY = "pebble-ai-privacy-ack";

/** The assistant talks to the plain-text editor, so the harness supplies a real textarea. */
function Harness({ initial = "Dear Anna,\n\nI will be late on Friday." }: { initial?: string }) {
  const [rawSource, setRawSource] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <textarea
        aria-label="body"
        ref={textareaRef}
        value={rawSource}
        onChange={(e) => setRawSource(e.target.value)}
      />
      <ComposeAiAssistant
        editor={null}
        editorMode="markdown"
        rawSource={rawSource}
        setRawSource={setRawSource}
        textareaRef={textareaRef}
        quotedReplyHtml=""
      />
    </div>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "ai.menuTooltip" }));
}

function acceptPrivacy() {
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "translate.acceptAndContinue" }));
}

describe("ComposeAiAssistant", () => {
  beforeEach(() => {
    localStorage.clear();
    polishMock.mockReset();
    proofreadMock.mockReset();
    translateMock.mockReset();
    helpWriteMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("gates every action behind the privacy acknowledgement", () => {
    render(<Harness />);
    openMenu();

    expect(screen.getByText("ai.privacyNotice")).toBeTruthy();
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(proofreadMock).not.toHaveBeenCalled();
  });

  it("offers polish, proofread, translate and help-write once acknowledged", () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    render(<Harness />);
    openMenu();

    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toEqual(["ai.polish", "ai.proofread", "ai.translate", "ai.helpWrite"]);
  });

  it("keeps the editor untouched until the user confirms the result", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    proofreadMock.mockResolvedValue({ text: "Dear Anna,\n\nI will be late on Friday!", engine: "ai" });
    render(<Harness />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "ai.proofread" }));

    await waitFor(() => expect(proofreadMock).toHaveBeenCalledOnce());
    expect(proofreadMock.mock.calls[0][0]).toContain("Dear Anna,");

    // The review dialog shows both sides and the original is still in the editor.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("body") as HTMLTextAreaElement).value).toBe(
      "Dear Anna,\n\nI will be late on Friday.",
    );
  });

  it("replaces the draft when the user accepts the result", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    proofreadMock.mockResolvedValue({ text: "Polished body.", engine: "ai" });
    render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "ai.proofread" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "ai.replace" }));

    await waitFor(() => {
      expect((screen.getByLabelText("body") as HTMLTextAreaElement).value).toBe("Polished body.");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("appends the result without dropping the original", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    translateMock.mockResolvedValue({ text: "Cher Anna,", engine: "ai" });
    render(<Harness initial="Dear Anna," />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "ai.translate" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "ai.insertBelow" }));

    await waitFor(() => {
      expect((screen.getByLabelText("body") as HTMLTextAreaElement).value).toBe("Dear Anna,\n\nCher Anna,");
    });
  });

  it("says which engine produced the translation when the fallback answered", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    translateMock.mockResolvedValue({ text: "Cher Anna,", engine: "translate" });
    render(<Harness initial="Dear Anna," />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "ai.translate" }));

    await screen.findByRole("dialog");
    expect(screen.getByText(/ai\.engineTranslate/)).toBeTruthy();
  });

  it("asks for an intent before drafting with help-write", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    render(<Harness initial="Dear Anna," />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "ai.helpWrite" }));

    expect(helpWriteMock).not.toHaveBeenCalled();
    const intent = screen.getByLabelText("ai.intent");

    helpWriteMock.mockResolvedValue({ text: "Drafted body.", engine: "ai" });
    fireEvent.change(intent, { target: { value: "apologise for the delay" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.generate" }));

    await waitFor(() => {
      expect(helpWriteMock).toHaveBeenCalledWith(
        "apologise for the delay",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });
  });

  it("surfaces a service failure in the review dialog and retries on request", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    polishMock.mockRejectedValueOnce(new Error("AI service error 403"));
    render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "ai.polish" }));

    expect(await screen.findByText("AI service error 403")).toBeTruthy();

    polishMock.mockResolvedValueOnce({ text: "Better body.", engine: "ai" });
    fireEvent.click(screen.getByRole("button", { name: /ai\.retry/ }));

    expect(await screen.findByText("Better body.")).toBeTruthy();
  });

  it("drafts from an empty composer, which is what help-write is for", async () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    render(<Harness initial="" />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "ai.helpWrite" }));
    expect(helpWriteMock).not.toHaveBeenCalled();

    helpWriteMock.mockResolvedValue({ text: "Dear Anna,\n\nThanks for the note.", engine: "ai" });
    fireEvent.change(screen.getByLabelText("ai.intent"), {
      target: { value: "thank Anna for the note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai.generate" }));

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "ai.replace" }));

    await waitFor(() => {
      expect((screen.getByLabelText("body") as HTMLTextAreaElement).value).toBe(
        "Dear Anna,\n\nThanks for the note.",
      );
    });
  });

  it("refuses to run on an empty editor", () => {
    profileLocalStorage.setItem(PRIVACY_ACK_KEY, "1");
    render(<Harness initial="   " />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "ai.proofread" }));

    expect(proofreadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
