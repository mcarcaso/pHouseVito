import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { requestJson } from "../lib/api-client";
import { messagePageSchema, type DashboardMessage, type MessagePage } from "./useSessions";

const PAGE_SIZE = 10;

interface ChatMessageFilters {
  showThoughts: boolean;
  showTools: boolean;
}

function messagesUrl(
  sessionId: string,
  filters: ChatMessageFilters,
  page: { before?: number; after?: number; limit?: number },
): string {
  const params = new URLSearchParams();
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  if (page.before !== undefined) params.set("before", String(page.before));
  if (page.after !== undefined) params.set("after", String(page.after));
  if (!filters.showThoughts) params.set("hideThoughts", "true");
  if (!filters.showTools) params.set("hideTools", "true");
  return `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`;
}

export function useChatMessages(sessionId: string, filters: ChatMessageFilters) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["chat-messages", sessionId, filters.showThoughts, filters.showTools] as const,
    [sessionId, filters.showThoughts, filters.showTools],
  );
  const messagesQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      requestJson(
        messagesUrl(sessionId, filters, { before: pageParam, limit: PAGE_SIZE }),
        messagePageSchema,
      ),
    initialPageParam: undefined as number | undefined,
    getPreviousPageParam: (firstPage, allPages) => {
      const loadedCount = allPages.reduce((count, page) => count + page.messages.length, 0);
      if (firstPage.messages.length < PAGE_SIZE || loadedCount >= firstPage.total) return undefined;
      return firstPage.messages[0]?.id;
    },
    getNextPageParam: () => undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const messages = useMemo(() => {
    const seen = new Set<number>();
    const result: DashboardMessage[] = [];
    for (const page of messagesQuery.data?.pages ?? []) {
      for (const message of page.messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        result.push(message);
      }
    }
    return result.sort((left, right) => left.id - right.id);
  }, [messagesQuery.data]);

  const highWatermark = messages.at(-1)?.id;
  const newMessagesQuery = useQuery({
    queryKey: [
      "chat-new-messages",
      sessionId,
      filters.showThoughts,
      filters.showTools,
      highWatermark ?? null,
    ],
    queryFn: () =>
      requestJson(
        messagesUrl(sessionId, filters, {
          limit: PAGE_SIZE,
          ...(highWatermark === undefined ? {} : { after: highWatermark }),
        }),
        messagePageSchema,
      ),
    enabled: messagesQuery.isSuccess,
    refetchInterval: 5_000,
    staleTime: 0,
  });

  useEffect(() => {
    const incoming = newMessagesQuery.data;
    if (!incoming || incoming.messages.length === 0) return;

    queryClient.setQueryData<InfiniteData<MessagePage, number | undefined>>(queryKey, (current) => {
      if (!current || current.pages.length === 0) return current;
      const knownIds = new Set(current.pages.flatMap((page) => page.messages.map(({ id }) => id)));
      const additions = incoming.messages.filter(({ id }) => !knownIds.has(id));
      if (additions.length === 0) return current;

      const pages = [...current.pages];
      const lastIndex = pages.length - 1;
      pages[lastIndex] = {
        ...pages[lastIndex],
        messages: [...pages[lastIndex].messages, ...additions],
        total: incoming.total,
      };
      return { ...current, pages };
    });
  }, [newMessagesQuery.data, queryClient, queryKey]);

  return {
    ...messagesQuery,
    messages,
    lowWatermark: messages[0]?.id,
    highWatermark,
  };
}
