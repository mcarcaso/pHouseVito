import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson, requestText } from "../lib/api-client";
const fileSchema = z.object({
  name: z.string(),
  size: z.number(),
  isPublic: z.boolean(),
  createdAt: z.string().optional(),
});
const listingSchema = z.object({
  path: z.string(),
  meta: z.object({ isPublic: z.boolean().optional() }).passthrough().nullable(),
  isPublic: z.boolean(),
  dirs: z.array(
    z.object({
      name: z.string(),
      hasMeta: z.boolean(),
      meta: z.object({ isPublic: z.boolean().optional() }).passthrough().nullable(),
    }),
  ),
  files: z.array(fileSchema),
});
export type DriveListing = z.infer<typeof listingSchema>;
export function useDriveListing(path: string) {
  return useQuery({
    queryKey: ["drive", path],
    queryFn: () => requestJson(`/api/drive/ls?path=${encodeURIComponent(path)}`, listingSchema),
  });
}
type DriveCommand =
  | { type: "directory-meta"; path: string; isPublic: boolean }
  | { type: "file-meta"; path: string; isPublic: boolean }
  | { type: "delete"; path: string }
  | { type: "upload"; site: boolean; body: unknown };
export function useDriveCommand() {
  const q = useQueryClient();
  return useMutation({
    mutationFn: (command: DriveCommand) => {
      if (command.type === "delete")
        return requestJson(`/api/drive?path=${encodeURIComponent(command.path)}`, z.unknown(), {
          method: "DELETE",
        });
      if (command.type === "upload")
        return requestJson(
          command.site ? "/api/drive/upload-site" : "/api/drive/upload",
          z.unknown(),
          jsonRequest("POST", command.body),
        );
      const endpoint = command.type === "file-meta" ? "file-meta" : "meta";
      return requestJson(
        `/api/drive/${endpoint}?path=${encodeURIComponent(command.path)}`,
        z.unknown(),
        jsonRequest("PUT", { isPublic: command.isPublic }),
      );
    },
    onSuccess: () => q.invalidateQueries({ queryKey: ["drive"] }),
  });
}
export function useDriveTextFile(url: string | null) {
  return useQuery({
    queryKey: ["drive-file", url],
    queryFn: () => requestText(url ?? ""),
    enabled: url !== null,
  });
}
