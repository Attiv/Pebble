import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../../src/lib/api";

const mocks = vi.hoisted(() => ({
  mailState: {
    activeAccountId: "account-1" as string | null,
    activeFolderId: null as string | null,
    selectedMessageId: null as string | null,
    selectedThreadId: null as string | null,
    threadView: false,
    setSelectedMessage: vi.fn(),
    setSelectedThreadId: vi.fn(),
    toggleThreadView: vi.fn(),
  },
  accounts: [
    { id: "account-1", email: "one@example.com", provider: "gmail" },
    { id: "account-2", email: "two@example.com", provider: "gmail" },
  ] as Account[],
  folders: [] as Array<{ id: string; account_id: string; role: string; sort_order: number }>,
  triggerSync: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("../../../src/stores/mail.store", () => ({
  useMailStore: (selector: (state: typeof mocks.mailState) => unknown) => selector(mocks.mailState),
}));

vi.mock("../../../src/stores/ui.store", () => ({
  useUIStore: (selector: (state: { setActiveView: () => void }) => unknown) =>
    selector({ setActiveView: vi.fn() }),
}));

vi.mock("../../../src/stores/toast.store", () => ({
  useToastStore: (selector: (state: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({ data: mocks.accounts }),
  useFoldersForAccountsQuery: () => ({ data: mocks.folders, isFetched: true }),
  useMessagesQuery: () => ({
    data: [],
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useThreadsQuery: () => ({ data: [], isLoading: false }),
  patchMessagesCache: vi.fn(),
}));

vi.mock("../../../src/components/SearchBar", () => ({ default: () => <div>Search bar</div> }));
vi.mock("../../../src/components/MessageList", () => ({ default: () => <div>Message list</div> }));
vi.mock("../../../src/components/MessageDetail", () => ({ default: () => <div>Message detail</div> }));
vi.mock("../../../src/features/inbox/ThreadView", () => ({ default: () => <div>Thread detail</div> }));
vi.mock("../../../src/components/ConfirmDialog", () => ({ default: () => <div>Confirm dialog</div> }));

vi.mock("../../../src/lib/api", () => ({
  emptyTrash: vi.fn(),
  triggerSync: mocks.triggerSync,
}));

import InboxView from "../../../src/features/inbox/InboxView";

describe("InboxView mailbox that has not synced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts = [
      { id: "account-1", email: "one@example.com", provider: "gmail" },
      { id: "account-2", email: "two@example.com", provider: "gmail" },
    ] as Account[];
    mocks.folders = [];
    mocks.mailState.activeAccountId = "account-1";
    mocks.mailState.activeFolderId = null;
    mocks.mailState.selectedMessageId = null;
    mocks.mailState.selectedThreadId = null;
    mocks.mailState.threadView = false;
    mocks.triggerSync.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  it("explains the mailbox is unsynced instead of asking for a new account", () => {
    render(<InboxView />);

    expect(screen.getByText("This mailbox has not synced yet")).toBeTruthy();
    // The account already exists, so the setup CTA would be a dead end.
    expect(screen.queryByText("Add an email account to get started")).toBeNull();
    expect(screen.queryByText("Add Account")).toBeNull();
    expect(screen.getByText("Sync now")).toBeTruthy();
  });

  it("still shows the add-account welcome when no account is configured", () => {
    mocks.accounts = [];
    render(<InboxView />);

    expect(screen.getByText("Welcome to Pebble")).toBeTruthy();
    expect(screen.queryByText("Sync now")).toBeNull();
  });

  it("waits quietly while a mailbox that has folders is being selected", () => {
    mocks.folders = [{ id: "f1", account_id: "account-1", role: "inbox", sort_order: 0 }];
    render(<InboxView />);

    expect(screen.queryByText("This mailbox has not synced yet")).toBeNull();
    expect(screen.queryByText("Welcome to Pebble")).toBeNull();
    expect(screen.queryByText("Sync now")).toBeNull();
  });

  it("syncs the selected mailbox and refreshes the cached views", async () => {
    render(<InboxView />);

    fireEvent.click(screen.getByText("Sync now"));

    await waitFor(() => expect(mocks.triggerSync).toHaveBeenCalledWith("account-1", "manual"));
    // Only the selected mailbox is synced, not every account.
    expect(mocks.triggerSync).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["folders"] }),
    );
  });

  it("syncs every mailbox when the combined view is selected", async () => {
    mocks.mailState.activeAccountId = null;
    render(<InboxView />);

    fireEvent.click(screen.getByText("Sync now"));

    await waitFor(() => expect(mocks.triggerSync).toHaveBeenCalledTimes(2));
    expect(mocks.triggerSync).toHaveBeenCalledWith("account-1", "manual");
    expect(mocks.triggerSync).toHaveBeenCalledWith("account-2", "manual");
  });
});
