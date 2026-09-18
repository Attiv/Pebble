import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MessageDetail from "../../src/components/MessageDetail";
import { useUIStore } from "../../src/stores/ui.store";
import { MESSAGE_THEME_STORAGE_KEY, MESSAGE_THEMES, getMessageTheme } from "../../src/lib/messageThemes";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../src/lib/api", () => ({
  trustSender: vi.fn(),
  aiSummarizeMessage: vi.fn(),
}));

vi.mock("../../src/hooks/useMessageLoader", () => ({
  useMessageLoader: () => ({
    message: {
      id: "message-1",
      account_id: "account-1",
      remote_id: "remote-1",
      message_id_header: null,
      in_reply_to: null,
      references_header: null,
      thread_id: null,
      subject: "Quarterly numbers",
      snippet: "Numbers attached",
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
      body_text: "The numbers are in the attachment.",
      body_html_raw: "",
    },
    setMessage: vi.fn(),
    rendered: { html: "<p>Body</p>", images_blocked: 0, trackers_blocked: [] },
    loading: false,
    error: null,
  }),
}));

vi.mock("../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({ data: [] }),
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

vi.mock("../../src/components/PrivacyBanner", () => ({
  default: () => <div>privacy banner</div>,
}));

vi.mock("../../src/components/ShadowDomEmail", () => ({
  ShadowDomEmail: ({ html, theme }: { html: string; theme?: { id: string } }) => (
    <div data-testid="shadow-body" data-theme-id={theme?.id}>
      {html}
    </div>
  ),
}));

vi.mock("../../src/features/translate/TranslatePopover", () => ({
  default: () => <div>translate popover</div>,
}));

vi.mock("../../src/components/ContactAddressAction", () => ({
  default: ({ address }: { address: string }) => <span>{address}</span>,
}));

function renderDetail() {
  return render(<MessageDetail messageId="message-1" onBack={vi.fn()} />);
}

function container(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-message-theme]");
  if (!el) throw new Error("message detail container not found");
  return el;
}

function header(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".message-detail-header");
  if (!el) throw new Error("message detail header not found");
  return el;
}

describe("MessageDetail themes", () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ messageTheme: "card" });
  });

  it("renders on the default template and publishes its layout", () => {
    renderDetail();

    expect(container().getAttribute("data-message-theme")).toBe("card");
    expect(container().getAttribute("data-msg-structure")).toBe("stacked");
    expect(container().getAttribute("data-msg-toolbar")).toBe("below");
    expect(container().getAttribute("data-msg-header-card")).toBe("true");
    expect(container().style.getPropertyValue("--msg-page-padding")).toBe("20px");
    expect(container().style.getPropertyValue("--msg-page-background")).toBe(
      getMessageTheme("card").page.background,
    );
  });

  it("shows the sender monogram in the templates that ask for one", () => {
    const first = renderDetail();
    expect(document.querySelector(".message-detail-avatar")?.textContent).toBe("SE");
    first.unmount();

    useUIStore.setState({ messageTheme: "wechat" });
    const second = renderDetail();
    expect(document.querySelector(".message-detail-avatar")?.textContent).toBe("SE");
    second.unmount();
  });

  it("switches template from the header picker and remembers the choice", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Message theme" }));

    fireEvent.click(document.querySelector('[data-message-theme-option="letter"]')!);

    expect(container().getAttribute("data-message-theme")).toBe("letter");
    expect(container().style.getPropertyValue("--msg-body-color")).toBe("#3b3229");
    expect(container().style.getPropertyValue("--msg-content-width")).toBe("640px");
    expect(container().style.getPropertyValue("--msg-accent")).toBe(
      getMessageTheme("letter").accent,
    );
    expect(container().getAttribute("data-msg-align")).toBe("center");
    expect(localStorage.getItem(MESSAGE_THEME_STORAGE_KEY)).toBe("letter");
  });

  it("switches into a brand skin and publishes its own accent", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Message theme" }));

    fireEvent.click(document.querySelector('[data-message-theme-option="wechat"]')!);

    expect(container().getAttribute("data-message-theme")).toBe("wechat");
    expect(container().style.getPropertyValue("--msg-accent")).toBe("#07c160");
    expect(container().style.getPropertyValue("--msg-divider")).toBe(
      getMessageTheme("wechat").divider,
    );
    // The accent is the action colour; links keep WeChat's slate blue.
    expect(container().style.getPropertyValue("--msg-link-color")).toBe("#576b95");
    expect(localStorage.getItem(MESSAGE_THEME_STORAGE_KEY)).toBe("wechat");
  });

  it("passes the template through to the body renderer", () => {
    useUIStore.setState({ messageTheme: "console" });
    renderDetail();

    const body = screen.getByTestId("shadow-body");
    expect(body.getAttribute("data-theme-id")).toBe("console");
    expect(container().style.getPropertyValue("--msg-content-width")).toBe("none");
  });

  it("moves the action toolbar into the sidebar for a two-column template", () => {
    useUIStore.setState({ messageTheme: "console" });
    renderDetail();

    const aside = document.querySelector(".message-detail-aside");
    expect(container().getAttribute("data-msg-structure")).toBe("columns");
    expect(aside).not.toBeNull();
    expect(aside?.textContent).toContain("message actions");
    expect(header().textContent).not.toContain("message actions");
  });

  it("keeps the action toolbar in the header for every stacked template", () => {
    for (const theme of MESSAGE_THEMES) {
      if (theme.layout.structure !== "stacked") continue;
      useUIStore.setState({ messageTheme: theme.id });
      const view = renderDetail();

      expect(header().textContent).toContain("message actions");
      expect(document.querySelector(".message-detail-aside")).toBeNull();

      view.unmount();
    }
  });

  it("keeps the header, meta line and body region in every template", () => {
    for (const theme of MESSAGE_THEMES) {
      useUIStore.setState({ messageTheme: theme.id });
      const view = renderDetail();

      expect(screen.getByRole("heading", { name: "Quarterly numbers" })).toBeTruthy();
      expect(screen.getByText("Sender")).toBeTruthy();
      expect(screen.getByText("sender@example.com")).toBeTruthy();
      expect(screen.getByRole("region", { name: "Message body" })).toBeTruthy();
      expect(container().getAttribute("data-message-theme")).toBe(theme.id);
      expect(container().getAttribute("data-msg-toolbar")).toBe(theme.layout.toolbar);
      expect(screen.getByTestId("shadow-body").getAttribute("data-theme-id")).toBe(theme.id);

      view.unmount();
    }
  });
});
