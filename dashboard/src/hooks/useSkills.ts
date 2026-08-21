import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson, requestText } from "../lib/api-client";
const skillSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  source: z.enum(["builtin", "user"]),
});
const skillFileSchema = z.object({ name: z.string(), path: z.string() });
export type Skill = z.infer<typeof skillSchema>;
export type SkillFile = z.infer<typeof skillFileSchema>;
export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => requestJson("/api/skills", z.array(skillSchema)),
  });
}
export function useSkillFiles(name: string | null) {
  return useQuery({
    queryKey: ["skills", name, "files"],
    queryFn: () =>
      requestJson(`/api/skills/${encodeURIComponent(name ?? "")}/files`, z.array(skillFileSchema)),
    enabled: name !== null,
  });
}
export function useSkillFile(path: string | null) {
  return useQuery({
    queryKey: ["files", path],
    queryFn: () => requestText(`/api/file?path=${encodeURIComponent(path ?? "")}`),
    enabled: path !== null,
  });
}
