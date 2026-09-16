import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  counts: {} as Record<string, number>,
  /** An account whose first sync has not finished has no folders at all. */
  withFolders: true,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    // Interpolates, so a test can assert the wording a reader actually gets
    // ("3 unread") rather than the raw placeholder.
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!options) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ""));
    },
  }),
}));

vi.mock("../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({ data: mocks.accounts }),
  // One inbox per account, so a test can prove the folder list follows the
  // account that is selected.
  useFoldersForAccountsQuery: (accountIds: string[]) => ({
    data: mocks.withFolders
      ? (accountIds ?? []).map((accountId) => ({
          id: `folder-inbox-${accountId}`,
          account_id: accountId,
          remote_id: "INBOX",
          name: "Inbox",
          folder_type: "folder",
          role: "inbox",
          parent_id: null,
          color: null,
          is_system: true,
          sort_order: 0,
        }))
      : [],
    isFetched: true,
  }),
  invalidateUnreadViews: vi.fn(),
}));

// Keep the real `unreadCountForAccount` so the badge wiring is exercised, and
// only stub the data source.
vi.mock("../../src/hooks/queries/useAccountUnreadCounts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/hooks/queries/useAccountUnreadCounts")>();
  return {
    ...actual,
    useAccountUnreadCounts: () => mocks.counts,
  };
});

vi.mock("../../src/hooks/queries/useFolderUnreadCounts", () => ({
  useFolderUnreadCountsForAccounts: () => ({ data: {} }),
}));

vi.mock("../../src/lib/api", () => ({
  markAccountAllRead: vi.fn(),
}));

import Sidebar from "../../src/components/Sidebar";
import { useComposeStore } from "../../src/stores/compose.store";
import { useConfirmStore } from "../../src/stores/confirm.store";
import { useMailStore } from "../../src/stores/mail.store";
import { useUIStore } from "../../src/stores/ui.store";

const WORK = {
  id: "account-work",
  email: "me@work.example",
  account_label: "Work",
  provider: "imap",
  created_at: 1,
  updated_at: 1,
};

const PERSONAL = {
  id: "account-personal",
  email: "me@icloud.com",
  provider: "imap",
  created_at: 2,
  updated_at: 2,
};

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<Sidebar />, { wrapper });
}

function accountButton(accountId: string): HTMLElement {
  return within(screen.getByTestId(`account-row-${accountId}`)).getAllByRole("button")[0];
}

function allAccountsButton(): HTMLElement {
  return within(screen.getByTestId("account-row-all")).getAllByRole("button")[0];
}

describe("Sidebar account list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts = [WORK, PERSONAL];
    mocks.counts = {};
    mocks.withFolders = true;
    useUIStore.setState({
      sidebarCollapsed: false,
      activeView: "inbox",
      previousView: "inbox",
      showFolderUnreadCount: false,
    });
    useMailStore.setState({
      activeAccountId: "account-work",
      activeFolderId: null,
    });
    useComposeStore.setState({
      composeMode: null,
      composeReplyTo: null,
      composeDirty: false,
      showComposeLeaveConfirm: false,
      pendingView: null,
    });
    useConfirmStore.setState({ confirm: vi.fn().mockResolvedValue(true) });
  });

  it("lists every account at once instead of hiding them behind a picker", () => {
    renderSidebar();

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("account-row-account-work")).toBeTruthy();
    expect(screen.getByTestId("account-row-account-personal")).toBeTruthy();
  });

  it("shows a custom label and the address it belongs to", () => {
    renderSidebar();

    const row = screen.getByTestId("account-row-account-work");
    expect(row.textContent).toContain("Work");
    expect(row.textContent).toContain("me@work.example");

    // An account without a label shows the address once, not twice.
    const personal = screen.getByTestId("account-row-account-personal");
    expect(personal.textContent?.match(/me@icloud\.com/g)).toHaveLength(1);
  });

  it("marks the selected account and moves the folders with it", () => {
    renderSidebar();

    expect(accountButton("account-work").getAttribute("aria-current")).toBe("true");
    expect(accountButton("account-personal").getAttribute("aria-current")).toBeNull();
    expect(useMailStore.getState().activeFolderId).toBe("folder-inbox-account-work");

    fireEvent.click(accountButton("account-personal"));

    expect(useMailStore.getState().activeAccountId).toBe("account-personal");
    // The previous account's folder must not survive the switch.
    expect(useMailStore.getState().activeFolderId).toBe("folder-inbox-account-personal");
  });

  it("switches to the combined mailbox from the all-accounts row", () => {
    renderSidebar();

    expect(allAccountsButton().getAttribute("aria-current")).toBeNull();
    fireEvent.click(allAccountsButton());

    expect(useMailStore.getState().activeAccountId).toBeNull();
    expect(allAccountsButton().getAttribute("aria-current")).toBe("true");
  });

  it("omits the combined row when only one mailbox is configured", () => {
    mocks.accounts = [WORK];
    renderSidebar();

    expect(screen.queryByTestId("account-row-all")).toBeNull();
    expect(screen.getByTestId("account-row-account-work")).toBeTruthy();
  });

  it("hides per-account counts unless count badges are enabled", () => {
    mocks.counts = { "account-work": 3, "account-personal": 7 };
    renderSidebar();

    expect(screen.queryByTestId("account-unread-account-work")).toBeNull();
    expect(screen.queryByTestId("account-unread-account-personal")).toBeNull();
    expect(screen.queryByTestId("account-unread-all")).toBeNull();
  });

  it("shows a per-account unread count when count badges are enabled", () => {
    mocks.counts = { "account-work": 3, "account-personal": 7 };
    useUIStore.setState({ showFolderUnreadCount: true });
    renderSidebar();

    expect(screen.getByTestId("account-unread-account-work").textContent).toBe("3");
    expect(screen.getByTestId("account-unread-account-personal").textContent).toBe("7");
  });

  it("totals the unread count on the combined row", () => {
    mocks.counts = { "account-work": 3, "account-personal": 7 };
    useUIStore.setState({ showFolderUnreadCount: true });
    useMailStore.setState({ activeAccountId: null });
    renderSidebar();

    expect(screen.getByTestId("account-unread-all").textContent).toBe("10");
  });

  it("keeps a mailbox selected even when it has no folders yet", () => {
    // Regression: an account whose sync never finished has no folders, and the
    // sidebar used to advance to the next account, making it unselectable.
    mocks.withFolders = false;
    useMailStore.setState({ activeAccountId: null, activeFolderId: null });
    renderSidebar();

    fireEvent.click(accountButton("account-personal"));

    expect(useMailStore.getState().activeAccountId).toBe("account-personal");
    expect(accountButton("account-personal").getAttribute("aria-current")).toBe("true");
  });

  it("leaves Settings for the mail view when a mailbox is picked", () => {
    useUIStore.setState({ activeView: "settings" });
    renderSidebar();

    fireEvent.click(accountButton("account-personal"));

    expect(useMailStore.getState().activeAccountId).toBe("account-personal");
    expect(useUIStore.getState().activeView).toBe("inbox");
  });

  it("stays put in a view that already follows the selected account", () => {
    useUIStore.setState({ activeView: "starred" });
    renderSidebar();

    fireEvent.click(accountButton("account-personal"));

    expect(useMailStore.getState().activeAccountId).toBe("account-personal");
    expect(useUIStore.getState().activeView).toBe("starred");
  });

  it("keeps every account reachable while the sidebar is collapsed", () => {
    useUIStore.setState({ sidebarCollapsed: true });
    renderSidebar();

    // Labels are gone, so each row is identified by its accessible name.
    expect(screen.queryByText("Work")).toBeNull();
    expect(screen.getByLabelText("Work · me@work.example")).toBeTruthy();
    expect(screen.getByLabelText("me@icloud.com")).toBeTruthy();
  });

  it("pins the unread count to the avatar's corner", () => {
    mocks.counts = { "account-work": 3 };
    useUIStore.setState({ showFolderUnreadCount: true });
    renderSidebar();

    const badge = screen.getByTestId("account-unread-account-work");
    // Overlaid on the avatar rather than laid out beside the address, so mail
    // arriving never shifts the label.
    expect(badge.style.position).toBe("absolute");
    const avatar = badge.parentElement?.firstElementChild as HTMLElement;
    expect(avatar.style.borderRadius).toBe("50%");

    // Stated once: the row no longer repeats the number at its far end.
    expect(screen.getByTestId("account-row-account-work").textContent?.match(/3/g)).toHaveLength(1);
    // A mailbox with nothing waiting gets no badge at all.
    expect(screen.queryByTestId("account-unread-account-personal")).toBeNull();
  });

  it("keeps counting while the sidebar is collapsed", () => {
    // Collapsed rows show no label and no folder list, so the badge is the only
    // remaining signal that a mailbox has mail waiting.
    mocks.counts = { "account-personal": 7 };
    useUIStore.setState({ showFolderUnreadCount: true, sidebarCollapsed: true });
    renderSidebar();

    expect(screen.getByTestId("account-unread-account-personal").textContent).toBe("7");
  });

  it("spells the count out in a collapsed row's name", () => {
    mocks.counts = { "account-work": 3 };
    useUIStore.setState({ showFolderUnreadCount: true, sidebarCollapsed: true });
    renderSidebar();

    expect(screen.getByLabelText("Work · me@work.example · 3 unread")).toBeTruthy();
  });

  it("caps a large count so the badge keeps its width", () => {
    mocks.counts = { "account-work": 128, "account-personal": 4 };
    useUIStore.setState({ showFolderUnreadCount: true });
    renderSidebar();

    expect(screen.getByTestId("account-unread-account-work").textContent).toBe("99+");
    // The combined row is capped the same way, even though its total is 132.
    expect(screen.getByTestId("account-unread-all").textContent).toBe("99+");
  });
});
