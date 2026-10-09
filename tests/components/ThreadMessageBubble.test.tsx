import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ThreadMessageBubble from "../../src/components/ThreadMessageBubble";
import type { Message } from "../../src/lib/api";
import { getRenderedHtml } from "../../src/lib/api";

// The link menu reaches `@/lib/i18n` through the shared link helper, so the
// mock has to carry the plugin registration too.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../src/lib/api", () => ({
  getRenderedHtml: vi.fn().mockResolvedValue({
    html: "<p>Rendered</p>",
    trackers_blocked: [],
    images_blocked: 0,
  }),
}));

vi.mock("../../src/components/ShadowDomEmail", () => ({
  ShadowDomEmail: ({
    html,
    onLinkContextMenu,
  }: {
    html: string;
    onLinkContextMenu?: (link: { href: string; x: number; y: number }) => void;
  }) => (
    <div>
      {html}
      <button
        data-testid="thread-body-link"
        onClick={() => onLinkContextMenu?.({ href: "https://example.com/thread", x: 5, y: 6 })}
      >
        link
      </button>
    </div>
  ),
}));

vi.mock("../../src/components/ContactAddressAction", () => ({
  default: ({ address }: { address: string }) => (
    <span data-testid="contact-address-action">{address}</span>
  ),
}));

const message: Message = {
  id: "message-1",
  account_id: "account-1",
  remote_id: "remote-1",
  message_id_header: null,
  in_reply_to: null,
  references_header: null,
  thread_id: "thread-1",
  subject: "Thread message",
  snippet: "Snippet",
  from_address: "sender@example.com",
  from_name: "Sender",
  to_list: [{ name: null, address: "user@example.com" }],
  cc_list: [{ name: null, address: "cc@example.com" }],
  bcc_list: [],
  has_attachments: false,
  is_read: true,
  is_starred: false,
  is_draft: false,
  date: 1_700_000_000,
  remote_version: null,
  is_deleted: false,
  deleted_at: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  body_text: "Body",
  body_html_raw: "<p>Body</p>",
};

const writeText = vi.fn();

describe("ThreadMessageBubble", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("shows copied recipients when expanded", () => {
    render(<ThreadMessageBubble message={message} defaultExpanded />);

    expect(document.body.textContent).toContain("Cc: cc@example.com");
  });

  it("uses relaxed privacy mode by default when rendering expanded thread messages", async () => {
    localStorage.removeItem("pebble-privacy-mode");

    render(<ThreadMessageBubble message={message} defaultExpanded />);

    await waitFor(() => {
      expect(getRenderedHtml).toHaveBeenCalledWith("message-1", "LoadOnce");
    });
  });

  it("offers contact actions for expanded message participants", () => {
    render(<ThreadMessageBubble message={message} defaultExpanded />);

    expect(document.querySelectorAll("[data-testid='contact-address-action']")).toHaveLength(3);
  });

  /// A thread body is the same isolated renderer as the message detail, so a
  /// link there must offer its address too.
  it("offers the copy-link menu for a thread body link", async () => {
    render(<ThreadMessageBubble message={message} defaultExpanded />);

    fireEvent.click(await screen.findByTestId("thread-body-link"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com/thread");
    });
  });
});
