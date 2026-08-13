/** Best-effort plain-text extraction from a pi message's content field. */
export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string") parts.push(b.text);
      else if (typeof b.thinking === "string") parts.push(b.thinking);
      else if (b.type === "tool_use" && typeof b.name === "string") {
        parts.push(`[tool_use: ${b.name}]`);
      } else if (b.type === "tool_result") {
        const result = b.content;
        if (typeof result === "string") parts.push(`[tool_result] ${result}`);
        else parts.push("[tool_result]");
      }
    }
    return parts.join("\n\n");
  }
  return "";
}

export function roleColor(role: string): string {
  switch (role) {
    case "user":
      return "bg-blue-950/30 border-blue-900/50 text-blue-100";
    case "assistant":
      return "bg-violet-950/30 border-violet-900/50 text-violet-100";
    case "tool":
      return "bg-emerald-950/20 border-emerald-900/40 text-emerald-100";
    default:
      return "bg-neutral-900 border-neutral-800 text-neutral-200";
  }
}

export function roleBadgeColor(role: string): string {
  switch (role) {
    case "user":
      return "bg-blue-500/20 text-blue-300";
    case "assistant":
      return "bg-violet-500/20 text-violet-300";
    case "tool":
      return "bg-emerald-500/20 text-emerald-300";
    default:
      return "bg-neutral-700 text-neutral-300";
  }
}

export const formatDate = (ts: number) => new Date(ts).toLocaleString();
export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};
