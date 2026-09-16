import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mirrors a real mailbox set: an inbox folder is only created once the account's
 * folder list has been synced from the provider. Accounts that only ever got the
 * locally-created folders have no inbox at all.
 */
const mocks = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  foldersByAccount: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock("../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({ data: mocks.accounts }),
  useFoldersForAccountsQuery: (accountIds: string[]) => ({
    data: (accountIds ?? []).flatMap((accountId) => mocks.foldersByAccount[accountId] ?? []),
    isFetched: true,
  }),
  invalidateUnreadViews: vi.fn(),
}));

vi.mock("../../src/hooks/queries/useAccountUnreadCounts", () => ({
  useAccountUnreadCounts: () => ({}),
  unreadCountForAccount: () => 0,
}));

vi.mock("../../src/hooks/queries/useFolderUnreadCounts", () => ({
  useFolderUnreadCountsForAccounts: () => ({ data: {} }),
}));

vi.mock("../../src/lib/api", () => ({ markAccountAllRead: vi.fn() }));

import Sidebar from "../../src/components/Sidebar";
import { useComposeStore } from "../../src/stores/compose.store";
import { useConfirmStore } from "../../src/stores/confirm.store";
import { useMailStore } from "../../src/stores/mail.store";
import { useUIStore } from "../../src/stores/ui.store";

function account(id: string, email: string) {
  return { id, email, provider: "gmail", created_at: 1, updated_at: 1 };
}

function inbox(accountId: string) {
  return {
    id: `inbox-${accountId}`,
    account_id: accountId,
    remote_id: "INBOX",
    name: "Inbox",
    folder_type: "folder",
    role: "inbox",
    parent_id: null,
    color: null,
    is_system: true,
    sort_order: 0,
  };
}

function archive(accountId: string) {
  return {
    id: `archive-${accountId}`,
    account_id: accountId,
    remote_id: "__local_archive__",
    name: "Archive",
    folder_type: "folder",
    role: "archive",
    parent_id: null,
    color: null,
    is_system: true,
    sort_order: 9,
  };
}

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<Sidebar />, { wrapper });
}

function rowButton(accountId: string): HTMLElement {
  return within(screen.getByTestId(`account-row-${accountId}`)).getAllByRole("button")[0];
}

describe("Sidebar account list with unfolded mailboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Two mailboxes synced their folders and have an inbox; three only ever got
    // the local Archive folder.
    mocks.accounts = [
      account("acct-work", "work@example.com"),
      account("acct-g1", "one@gmail.com"),
      account("acct-g2", "two@gmail.com"),
      account("acct-g3", "three@gmail.com"),
      account("acct-163", "user@163.com"),
    ];
    mocks.foldersByAccount = {
      "acct-work": [inbox("acct-work"), archive("acct-work")],
      "acct-163": [inbox("acct-163"), archive("acct-163")],
      "acct-g1": [archive("acct-g1")],
      "acct-g2": [archive("acct-g2")],
      "acct-g3": [archive("acct-g3")],
    };
    useUIStore.setState({
      sidebarCollapsed: false,
      activeView: "inbox",
      previousView: "inbox",
      showFolderUnreadCount: false,
    });
    useMailStore.setState({ activeAccountId: "acct-work", activeFolderId: null });
    useComposeStore.setState({
      composeMode: null,
      composeReplyTo: null,
      composeDirty: false,
      showComposeLeaveConfirm: false,
      pendingView: null,
    });
    useConfirmStore.setState({ confirm: vi.fn().mockResolvedValue(true) });
  });

  it.each(["acct-g1", "acct-g2", "acct-g3"])(
    "selects %s even though it has no inbox folder",
    (accountId) => {
      renderSidebar();

      fireEvent.click(rowButton(accountId));

      expect(useMailStore.getState().activeAccountId).toBe(accountId);
      expect(rowButton(accountId).getAttribute("aria-current")).toBe("true");
    },
  );

  it("falls back to the only folder when there is no inbox to select", () => {
    renderSidebar();

    fireEvent.click(rowButton("acct-g1"));

    // Archive is all this mailbox has, so it must be what gets shown.
    expect(useMailStore.getState().activeFolderId).toBe("archive-acct-g1");
  });

  it("still lands on the inbox for a mailbox that has one", () => {
    renderSidebar();

    fireEvent.click(rowButton("acct-163"));

    expect(useMailStore.getState().activeFolderId).toBe("inbox-acct-163");
  });

  it("lists all five mailboxes so none is hidden", () => {
    renderSidebar();

    for (const a of mocks.accounts) {
      expect(screen.getByTestId(`account-row-${a.id}`)).toBeTruthy();
    }
  });
});
