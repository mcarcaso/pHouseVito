import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson } from "../lib/api-client";

const contentSchema = z.object({ content: z.string() });

export function useSoulContent() {
  return useQuery({
    queryKey: ["system-content", "soul"],
    queryFn: () => requestJson("/api/soul", contentSchema),
  });
}

export function useSystemPromptContent() {
  return useQuery({
    queryKey: ["system-content", "prompt"],
    queryFn: () => requestJson("/api/system-prompt", contentSchema),
  });
}
