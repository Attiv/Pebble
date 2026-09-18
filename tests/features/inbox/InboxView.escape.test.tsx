import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "../../../src/lib/api";

/**
 * Escape has to reach whichever view owns the open message. The inbox keeps its
 * selection in `mail.store` rather than in local state, so this file guards the
 * inbox end of `useCloseMessageDetail`.
 */

const mockMailState = {
  activeAccountId: "account-1",
  activeFolderId: "folder-inbox",
  selectedMessageId: null as string | null,
  selectedThreadId: "thread-1" as string | null,
  threadView: true,
  setSelectedMessage: vi.fn(),
  setSelectedThreadId: vi.fn(),
  toggleThreadView: vi.fn(),
};

const threads: ThreadSummary[] = [{
  thread_id: "thread-1",
  account_id: "account-1",
  subject: "Project update",
  snippet: "The latest project update",
  last_date: 1_700_000_000,
  message_count: 2,
  unread_count: 0,
  is_starred: false,
  participants: ["sender@example.com"],
  has_attachments: false,
}];

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
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 76,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 76,
      })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

vi.mock("../../../src/stores/mail.store", () => ({
  useMailStore: (selector: (state: typeof mockMailState) => unknown) => selector(mockMailState),
}));

vi.mock("../../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({
    data: [
      {
        id: "account-1",
        email: "work@example.com",
        display_name: "Work",
        account_label: "Work",
        color: null,
        provider: "imap",
        created_at: 1,
        updated_at: 1,
      },
    ],
  }),
  useFoldersForAccountsQuery: () => ({
    data: [{ id: "folder-inbox", role: "inbox" }],
  }),
  useMessagesQuery: () => ({
    data: [],
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useThreadsQuery: () => ({
    data: threads,
    isLoading: false,
  }),
  patchMessagesCache: vi.fn(),
}));

vi.mock("../../../src/components/SearchBar", () => ({
  default: () => <div>Search bar</div>,
}));

vi.mock("../../../src/components/MessageList", () => ({
  default: () => <div>Message list</div>,
}));

vi.mock("../../../src/components/MessageDetail", () => ({
  default: () => <div>Message detail</div>,
}));

vi.mock("../../../src/features/inbox/ThreadView", () => ({
  default: () => <div>Thread detail</div>,
}));

vi.mock("../../../src/components/ThreadItem", () => ({
  default: ({ thread }: { thread: ThreadSummary }) => <div>{thread.subject}</div>,
}));

vi.mock("../../../src/components/ConfirmDialog", () => ({
  default: () => <div>Confirm dialog</div>,
}));

vi.mock("../../../src/components/Skeleton", () => ({
  MessageListSkeleton: () => <div>Loading threads</div>,
}));

vi.mock("../../../src/lib/api", () => ({
  emptyTrash: vi.fn(),
}));

import InboxView from "../../../src/features/inbox/InboxView";
import { CLOSE_MESSAGE_DETAIL_EVENT } from "../../../src/hooks/useCloseMessageDetail";

/** Ask for the detail to close the way `useKeyboard` does, and report back. */
function requestClose(): boolean {
  const request = new CustomEvent(CLOSE_MESSAGE_DETAIL_EVENT, { cancelable: true });
  act(() => { document.dispatchEvent(request); });
  return request.defaultPrevented;
}

describe("InboxView — Escape closes the open message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMailState.activeAccountId = "account-1";
    mockMailState.activeFolderId = "folder-inbox";
    mockMailState.selectedMessageId = null;
    mockMailState.selectedThreadId = "thread-1";
    mockMailState.threadView = true;
  });

  it("closes an open thread and reports the keystroke as used", () => {
    render(<InboxView />);
    expect(screen.getByText("Thread detail")).toBeTruthy();

    expect(requestClose()).toBe(true);

    expect(mockMailState.setSelectedThreadId).toHaveBeenCalledWith(null);
    expect(mockMailState.setSelectedMessage).not.toHaveBeenCalled();
  });

  it("closes an open message when the inbox is not in thread view", () => {
    mockMailState.threadView = false;
    mockMailState.selectedThreadId = null;
    mockMailState.selectedMessageId = "message-1";
    render(<InboxView />);

    expect(requestClose()).toBe(true);

    expect(mockMailState.setSelectedMessage).toHaveBeenCalledWith(null);
    expect(mockMailState.setSelectedThreadId).not.toHaveBeenCalled();
  });

  // An unanswered request is how the shortcut layer learns it should go on to
  // the next thing Escape means — navigating out of a view, for instance.
  it("leaves the keystroke unanswered when no message is open", () => {
    mockMailState.threadView = false;
    mockMailState.selectedThreadId = null;
    mockMailState.selectedMessageId = null;
    render(<InboxView />);

    expect(requestClose()).toBe(false);

    expect(mockMailState.setSelectedMessage).not.toHaveBeenCalled();
    expect(mockMailState.setSelectedThreadId).not.toHaveBeenCalled();
  });
});
