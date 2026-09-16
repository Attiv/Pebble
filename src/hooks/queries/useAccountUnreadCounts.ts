import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getAccountUnreadCounts } from "@/lib/api";

export const accountUnreadCountsQueryKey = ["account-unread-counts"] as const;

/**
 * Unread mail per account, using the same scope the app icon badge counts
 * (unread, not deleted, and not filed exclusively under drafts, trash or spam).
 *
 * Never empty: accounts without unread mail are simply absent, so a missing key
 * means "nothing unread" and the account's mark-all-read action is a no-op.
 */
export function useAccountUnreadCounts(): Record<string, number> {
  const { data } = useQuery({
    queryKey: accountUnreadCountsQueryKey,
    queryFn: getAccountUnreadCounts,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  return data ?? EMPTY_COUNTS;
}

const EMPTY_COUNTS: Record<string, number> = {};

export function unreadCountForAccount(
  counts: Record<string, number>,
  accountId: string | null | undefined,
): number {
  if (!accountId) return 0;
  return counts[accountId] ?? 0;
}

/**
 * Refresh every view that renders read/unread state. Call after an action that
 * changes unread mail, alongside the app badge which the backend updates itself.
 */
export function invalidateUnreadViews(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["messages"] });
  queryClient.invalidateQueries({ queryKey: ["threads"] });
  queryClient.invalidateQueries({ queryKey: ["starred-messages"] });
  queryClient.invalidateQueries({ queryKey: ["folder-unread-counts"] });
  queryClient.invalidateQueries({ queryKey: accountUnreadCountsQueryKey });
}
