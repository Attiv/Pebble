import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  invalidateUnreadViews: vi.fn(),
  markAccountAllRead: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name] ?? ""),
      );
    },
  }),
}));

vi.mock("../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({
    data: [
      {
        id: "account-1",
        email: "user@example.com",
        display_name: "User",
        provider: "imap",
        created_at: 1,
        updated_at: 1,
      },
    ],
  }),
  useFoldersForAccountsQuery: () => ({
    data: [
      {
        id: "folder-inbox",
        account_id: "account-1",
        remote_id: "INBOX",
        name: "Inbox",
        folder_type: "folder",
        role: "inbox",
        parent_id: null,
        color: null,
        is_system: true,
        sort_order: 0,
      },
    ],
    isFetched: true,
  }),
  invalidateUnreadViews: mocks.invalidateUnreadViews,
}));

// Keep the real `unreadCountForAccount` so the sidebar wiring is exercised, and
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
  markAccountAllRead: mocks.markAccountAllRead,
}));

import Sidebar from "../../src/components/Sidebar";
import { ALL_ACCOUNTS_SELECT_VALUE } from "../../src/lib/folderAggregation";
import { useComposeStore } from "../../src/stores/compose.store";
import { useConfirmStore } from "../../src/stores/confirm.store";
import { useMailStore } from "../../src/stores/mail.store";
import { useUIStore } from "../../src/stores/ui.store";

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<Sidebar />, { wrapper });
}

describe("Sidebar mark-all-read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.counts = {};
    useUIStore.setState({
      sidebarCollapsed: false,
      activeView: "inbox",
      previousView: "inbox",
      showFolderUnreadCount: false,
    });
    useMailStore.setState({
      activeAccountId: "account-1",
      activeFolderId: "folder-inbox",
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

  it("offers the action but keeps it disabled when the mailbox has no unread mail", () => {
    renderSidebar();

    const button = screen.getByTestId("mark-all-read-account-1");
    expect(button.getAttribute("disabled")).not.toBeNull();
  });

  it("enables the action once the account has unread mail and clears it on click", async () => {
    mocks.counts = { "account-1": 4 };
    mocks.markAccountAllRead.mockResolvedValueOnce(4);
    renderSidebar();

    const button = screen.getByTestId("mark-all-read-account-1");
    expect(button.getAttribute("disabled")).toBeNull();

    fireEvent.click(button);

    await waitFor(() => expect(mocks.markAccountAllRead).toHaveBeenCalledWith("account-1"));
    expect(mocks.invalidateUnreadViews).toHaveBeenCalled();
  });

  it("hides the action when every account is shown at once", () => {
    mocks.counts = { "account-1": 4 };
    useMailStore.setState({ activeAccountId: ALL_ACCOUNTS_SELECT_VALUE });
    renderSidebar();

    expect(screen.queryByTestId("mark-all-read-account-1")).toBeNull();
  });
});
