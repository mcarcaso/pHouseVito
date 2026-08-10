import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  serverRestartResponseSchema,
  serverStatusResponseSchema,
} from "../../../src/shared/schemas/server-api";
import { requestJson } from "../lib/api-client";

const statusKey = ["server", "status"] as const;

export function useServerStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => requestJson("/api/server/status", serverStatusResponseSchema),
    refetchInterval: 5_000,
  });
}

export function useRestartServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await requestJson("/api/server/restart", serverRestartResponseSchema, { method: "POST" });
      } catch {
        // The process can exit before sending the response.
      }

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        try {
          return await queryClient.fetchQuery({
            queryKey: statusKey,
            queryFn: () => requestJson("/api/server/status", serverStatusResponseSchema),
            staleTime: 0,
          });
        } catch {
          // Continue polling while the process restarts.
        }
      }
      throw new Error("Server did not return within 30 seconds");
    },
  });
}
