import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateMessageFlags } from "@/lib/api";
import type { Message } from "@/lib/api";
import {
  patchMessagesCache,
  snapshotMessagesCache,
  restoreMessagesCache,
} from "@/hooks/queries";
import { accountUnreadCountsQueryKey } from "@/hooks/queries/useAccountUnreadCounts";

interface UpdateFlagsParams {
  messageId: string;
  isRead?: boolean;
  isStarred?: boolean;
  accountId?: string;
  previousIsRead?: boolean;
}

interface MutationContext {
  previousMessage: Message | null | undefined;
  previousLists: ReturnType<typeof snapshotMessagesCache>;
  previousAccountCounts: Record<string, number> | undefined;
}

export function useUpdateFlagsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: UpdateFlagsParams) =>
      updateMessageFlags(params.messageId, params.isRead, params.isStarred),
    onMutate: async (params): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: ["messages"] });
      await queryClient.cancelQueries({
        queryKey: ["message", params.messageId],
      });

      const previousMessage = queryClient.getQueryData<Message | null>([
        "message",
        params.messageId,
      ]);

      const previousLists = snapshotMessagesCache(queryClient);
      const previousAccountCounts = queryClient.getQueryData<Record<string, number>>(
        accountUnreadCountsQueryKey,
      );

      if (
        params.isRead !== undefined &&
        params.accountId &&
        params.previousIsRead !== undefined &&
        params.previousIsRead !== params.isRead
      ) {
        const delta = params.isRead ? -1 : 1;
        queryClient.setQueryData<Record<string, number>>(
          accountUnreadCountsQueryKey,
          (counts) => {
            if (!counts) return counts;
            const nextCount = Math.max(0, (counts[params.accountId!] ?? 0) + delta);
            const next = { ...counts };
            if (nextCount === 0) delete next[params.accountId!];
            else next[params.accountId!] = nextCount;
            return next;
          },
        );
      }

      if (previousMessage) {
        queryClient.setQueryData<Message | null>(
          ["message", params.messageId],
          {
            ...previousMessage,
            ...(params.isRead !== undefined && { is_read: params.isRead }),
            ...(params.isStarred !== undefined && {
              is_starred: params.isStarred,
            }),
          },
        );
      }

      patchMessagesCache(queryClient, (page) =>
        page.map((m) =>
          m.id === params.messageId
            ? {
                ...m,
                ...(params.isRead !== undefined && { is_read: params.isRead }),
                ...(params.isStarred !== undefined && { is_starred: params.isStarred }),
              }
            : m,
        ),
      );

      return { previousMessage, previousLists, previousAccountCounts };
    },
    onError: (_err, params, context) => {
      if (context?.previousMessage) {
        queryClient.setQueryData(
          ["message", params.messageId],
          context.previousMessage,
        );
      }
      if (context?.previousLists) {
        restoreMessagesCache(queryClient, context.previousLists);
      }
      if (context?.previousAccountCounts) {
        queryClient.setQueryData(accountUnreadCountsQueryKey, context.previousAccountCounts);
      }
    },
    onSettled: (_data, _err, params) => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["starred-messages"] });
      queryClient.invalidateQueries({ queryKey: ["message", params.messageId] });
      if (params.isRead !== undefined) {
        queryClient.invalidateQueries({ queryKey: ["folder-unread-counts"] });
        queryClient.invalidateQueries({ queryKey: accountUnreadCountsQueryKey });
      }
    },
  });
}
