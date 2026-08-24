import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { messagePageSchema, messageUrl, type MessagePage, type VitoMessage } from "./sessions";
import { requestJson, useVitoClient } from "./client";

const PAGE_SIZE = 10;
export interface ChatMessageFilters {
  showThoughts: boolean;
  showTools: boolean;
}

function url(
  sessionId: string,
  filters: ChatMessageFilters,
  page: { before?: number; after?: number; limit?: number },
) {
  return messageUrl(sessionId, {
    ...page,
    hideThoughts: !filters.showThoughts,
    hideTools: !filters.showTools,
  });
}

export function useChatMessages(sessionId: string, filters: ChatMessageFilters) {
  const client = useVitoClient();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["chat-messages", sessionId, filters.showThoughts, filters.showTools] as const,
    [sessionId, filters.showThoughts, filters.showTools],
  );
  const messagesQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      requestJson(
        client,
        url(sessionId, filters, { before: pageParam, limit: PAGE_SIZE }),
        messagePageSchema,
      ),
    initialPageParam: undefined as number | undefined,
    getPreviousPageParam: (first, pages) =>
      pages.reduce((n, page) => n + page.messages.length, 0) >= first.total ||
      first.messages.length < PAGE_SIZE
        ? undefined
        : first.messages[0]?.id,
    getNextPageParam: () => undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const messages = useMemo(() => {
    const seen = new Set<number>();
    const result: VitoMessage[] = [];
    for (const page of messagesQuery.data?.pages ?? [])
      for (const message of page.messages)
        if (!seen.has(message.id)) {
          seen.add(message.id);
          result.push(message);
        }
    return result.sort((a, b) => a.id - b.id);
  }, [messagesQuery.data]);
  const highWatermark = messages.at(-1)?.id;
  const incoming = useQuery({
    queryKey: [
      "chat-new-messages",
      sessionId,
      filters.showThoughts,
      filters.showTools,
      highWatermark ?? null,
    ],
    queryFn: () =>
      requestJson(
        client,
        url(sessionId, filters, {
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
    if (!incoming.data?.messages.length) return;
    queryClient.setQueryData<InfiniteData<MessagePage, number | undefined>>(queryKey, (current) => {
      if (!current?.pages.length) return current;
      const known = new Set(current.pages.flatMap((page) => page.messages.map((m) => m.id)));
      const additions = incoming.data.messages.filter((m) => !known.has(m.id));
      if (!additions.length) return current;
      const pages = [...current.pages];
      const index = pages.length - 1;
      pages[index] = {
        ...pages[index],
        messages: [...pages[index].messages, ...additions],
        total: incoming.data.total,
      };
      return { ...current, pages };
    });
  }, [incoming.data, queryClient, queryKey]);
  return { ...messagesQuery, messages, lowWatermark: messages[0]?.id, highWatermark };
}
