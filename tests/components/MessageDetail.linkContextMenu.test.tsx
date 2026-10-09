import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MessageDetail from "../../src/components/MessageDetail";
import type { Message } from "../../src/lib/api";

const LINK_HREF = "https://pebble.byebug.cn/docs?page=2";

const linkMocks = vi.hoisted(() => ({
  openMessageLink: vi.fn(),
}));

// Only the act of following a link is swapped; the predicates that decide what
// the menu may offer stay real.
vi.mock("../../src/lib/openMessageLink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/openMessageLink")>();
  return { ...actual, openMessageLink: linkMocks.openMessageLink };
});

const mockMessage: Message = {
  id: "message-1",
  account_id: "account-1",
  remote_id: "remote-1",
  message_id_header: null,
  in_reply_to: null,
  references_header: null,
  thread_id: null,
  subject: "A link in the body",
  snippet: "Body link test",
  from_address: "sender@example.com",
  from_name: "Sender",
  to_list: [],
  cc_list: [],
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
  body_text: "plain body",
  body_html_raw: "",
};

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../src/lib/api", () => ({
  trustSender: vi.fn(),
}));

vi.mock("../../src/hooks/useMessageLoader", () => ({
  useMessageLoader: (messageId: string) => ({
    message: { ...mockMessage, id: messageId },
    setMessage: vi.fn(),
    rendered: { html: `<p>See <a href="${LINK_HREF}">the docs</a></p>`, images_blocked: 0, trackers_blocked: [] },
    loading: false,
  }),
}));

vi.mock("../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({ data: [{ id: "account-1", email: "current@example.com" }] }),
}));

vi.mock("../../src/hooks/useBilingualTranslation", () => ({
  useBilingualTranslation: () => ({
    bilingualMode: false,
    bilingualResult: null,
    bilingualLoading: false,
    bilingualError: null,
    bilingualWarning: null,
    handleBilingualToggle: vi.fn(),
    resetBilingual: vi.fn(),
  }),
}));

vi.mock("../../src/components/MessageActionToolbar", () => ({
  default: () => <div>message actions</div>,
}));

vi.mock("../../src/components/AttachmentList", () => ({
  default: () => <div>attachments</div>,
}));

vi.mock("../../src/components/PrivacyBanner", () => ({
  default: () => <div>privacy</div>,
}));

vi.mock("../../src/features/inbox/SnoozePopover", () => ({
  default: () => <div>snooze</div>,
}));

vi.mock("../../src/features/translate/TranslatePopover", () => ({
  default: () => <div>translate popover</div>,
}));

vi.mock("../../src/components/ContactAddressAction", () => ({
  default: () => null,
}));

// The real component reports a right click on an anchor from inside its shadow
// root; this stands in for that report so the message-detail wiring is what is
// under test. `tests/components/ShadowDomEmail.test.tsx` covers the reporting.
vi.mock("../../src/components/ShadowDomEmail", () => ({
  ShadowDomEmail: ({
    onLinkContextMenu,
  }: {
    onLinkContextMenu?: (link: { href: string; x: number; y: number }) => void;
  }) => (
    <a
      href={LINK_HREF}
      data-testid="body-link"
      onContextMenu={(event) => {
        event.preventDefault();
        onLinkContextMenu?.({ href: LINK_HREF, x: 30, y: 44 });
      }}
    >
      the docs
    </a>
  ),
}));

const writeText = vi.fn();

describe("MessageDetail link context menu", () => {
  beforeEach(() => {
    linkMocks.openMessageLink.mockReset();
    linkMocks.openMessageLink.mockResolvedValue(undefined);
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("raises the link menu on a right click in the body and copies the address", async () => {
    render(<MessageDetail messageId="message-1" onBack={vi.fn()} />);

    expect(screen.queryByTestId("link-action-address")).toBeNull();

    fireEvent.contextMenu(screen.getByTestId("body-link"));

    const copy = await screen.findByRole("menuitem", { name: "Copy link" });
    expect(screen.getByTestId("link-action-address").textContent).toBe(LINK_HREF);

    fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK_HREF));
  });

  it("follows the link from the menu and then closes it", async () => {
    render(<MessageDetail messageId="message-1" onBack={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId("body-link"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open link" }));

    await waitFor(() => expect(linkMocks.openMessageLink).toHaveBeenCalledWith(LINK_HREF));
    expect(screen.queryByTestId("link-action-address")).toBeNull();
  });

  it("leaves no menu behind when the message changes", async () => {
    const { rerender } = render(<MessageDetail messageId="message-1" onBack={vi.fn()} />);

    fireEvent.contextMenu(screen.getByTestId("body-link"));
    expect(await screen.findByTestId("link-action-address")).toBeTruthy();

    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(screen.queryByTestId("link-action-address")).toBeNull());
    rerender(<MessageDetail messageId="message-1" onBack={vi.fn()} />);
    expect(screen.queryByTestId("link-action-address")).toBeNull();
  });
});
