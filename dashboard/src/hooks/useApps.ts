import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson } from "../lib/api-client";

const appSchema = z.object({
  name: z.string(),
  description: z.string(),
  port: z.number(),
  url: z.string(),
  createdAt: z.string(),
  status: z.string(),
  uptime: z.number().nullable(),
  restarts: z.number(),
  memory: z.number().nullable(),
});
const appFileSchema = z.object({
  path: z.string(),
  size: z.number(),
  isDir: z.boolean(),
});
const appFileContentSchema = z.object({ content: z.string() });
const actionResultSchema = z.object({ message: z.string().optional() }).passthrough();

export type App = z.infer<typeof appSchema>;
export type AppFile = z.infer<typeof appFileSchema>;
export type AppAction = "restart" | "stop" | "start" | "delete";

export function useApps() {
  return useQuery({
    queryKey: ["apps"],
    queryFn: () => requestJson("/api/apps", z.array(appSchema)),
    refetchInterval: 10_000,
  });
}

export function useAppFiles(appName: string | null) {
  return useQuery({
    queryKey: ["apps", appName, "files"],
    queryFn: () =>
      requestJson(`/api/apps/${encodeURIComponent(appName ?? "")}/files`, z.array(appFileSchema)),
    enabled: appName !== null,
  });
}

export function useAppFile(appName: string | null, filePath: string | null) {
  return useQuery({
    queryKey: ["apps", appName, "files", filePath],
    queryFn: () =>
      requestJson(
        `/api/apps/${encodeURIComponent(appName ?? "")}/files/${filePath ?? ""}`,
        appFileContentSchema,
      ),
    enabled: appName !== null && filePath !== null,
  });
}

export function useAppAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appName, action }: { appName: string; action: AppAction }) => {
      const url =
        action === "delete"
          ? `/api/apps/${encodeURIComponent(appName)}`
          : `/api/apps/${encodeURIComponent(appName)}/${action}`;
      return requestJson(url, actionResultSchema, {
        method: action === "delete" ? "DELETE" : "POST",
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apps"] }),
  });
}
