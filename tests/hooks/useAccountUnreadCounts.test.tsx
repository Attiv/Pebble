import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

// Import after mocking
import { getAccountUnreadCounts, markAccountAllRead } from "../../src/lib/api";
import {
  accountUnreadCountsQueryKey,
  invalidateUnreadViews,
  unreadCountForAccount,
  useAccountUnreadCounts,
} from "../../src/hooks/queries/useAccountUnreadCounts";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useAccountUnreadCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes a stable query key", () => {
    expect(accountUnreadCountsQueryKey).toEqual(["account-unread-counts"]);
  });

  it("getAccountUnreadCounts calls the correct Tauri command", async () => {
    mockInvoke.mockResolvedValueOnce({ "account-1": 4 });

    await expect(getAccountUnreadCounts()).resolves.toEqual({ "account-1": 4 });
    expect(mockInvoke).toHaveBeenCalledWith("get_account_unread_counts");
  });

  it("markAccountAllRead passes the account id and resolves with the cleared count", async () => {
    mockInvoke.mockResolvedValueOnce(12);

    await expect(markAccountAllRead("account-1")).resolves.toBe(12);
    expect(mockInvoke).toHaveBeenCalledWith("mark_account_all_read", {
      accountId: "account-1",
    });
  });

  it("reads as empty before the first response resolves", () => {
    mockInvoke.mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useAccountUnreadCounts(), {
      wrapper: createWrapper(createQueryClient()),
    });

    expect(result.current).toEqual({});
  });

  it("maps the per-account unread counts returned by the backend", async () => {
    mockInvoke.mockResolvedValueOnce({ "account-1": 3, "account-2": 7 });

    const { result } = renderHook(() => useAccountUnreadCounts(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() =>
      expect(result.current).toEqual({ "account-1": 3, "account-2": 7 }),
    );
  });

  it("unreadCountForAccount falls back to zero for unknown accounts", () => {
    const counts = { "account-1": 5 };

    expect(unreadCountForAccount(counts, "account-1")).toBe(5);
    expect(unreadCountForAccount(counts, "account-missing")).toBe(0);
    expect(unreadCountForAccount(counts, null)).toBe(0);
    expect(unreadCountForAccount(counts, undefined)).toBe(0);
  });

  it("invalidateUnreadViews refreshes every read-state view", () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    invalidateUnreadViews(queryClient);

    for (const key of ["messages", "threads", "starred-messages", "folder-unread-counts"]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: accountUnreadCountsQueryKey });
  });
});
