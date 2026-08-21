import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson } from "../lib/api-client";
const statsSchema = z.object({
  totalChunks: z.number(),
  totalSessions: z.number(),
  totalDays: z.number(),
  oldestDay: z.string(),
  newestDay: z.string(),
  sessions: z.array(
    z.object({
      session_id: z.string(),
      alias: z.string().nullable(),
      count: z.number(),
      first_day: z.string(),
      last_day: z.string(),
    }),
  ),
});
const resultSchema = z.object({
  id: z.number(),
  session_id: z.string(),
  day: z.string(),
  chunk_index: z.number(),
  text: z.string(),
  context: z.string().nullable(),
  msg_count: z.number(),
  rrfScore: z.number(),
  embeddingScore: z.number(),
  rawEmbeddingScore: z.number(),
  recencyFactor: z.number(),
  daysAgo: z.number(),
  bm25Score: z.number(),
});
const searchSchema = z.object({
  query: z.string(),
  mode: z.string(),
  duration_ms: z.number(),
  results: z.array(resultSchema),
});
export function useMemoryProfile() {
  return useQuery({
    queryKey: ["memory", "profile"],
    queryFn: () => requestJson("/api/memory/profile", z.object({ content: z.string().nullable() })),
  });
}
export function useEmbeddingStats() {
  return useQuery({
    queryKey: ["memory", "stats"],
    queryFn: () => requestJson("/api/memory/embeddings/stats", statsSchema),
  });
}
export function useMemorySearch() {
  return useMutation({
    mutationFn: ({ query, mode, limit }: { query: string; mode: string; limit: number }) =>
      requestJson(
        `/api/memory/embeddings/search?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}&limit=${limit}`,
        searchSchema,
      ),
  });
}
