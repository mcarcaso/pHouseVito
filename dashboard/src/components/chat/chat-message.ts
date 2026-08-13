export interface Attachment {
  type: "image" | "file" | "audio";
  data?: string;
  path?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
}

export interface DbMessage {
  id?: number;
  type: string; // 'user' | 'thought' | 'assistant' | 'tool_start' | 'tool_end'
  content: string;
  timestamp: number;
  author?: string | null;
}

export interface ParsedMessage {
  role: string;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  toolName?: string;
  toolPhase?: "start" | "end";
  toolArgs?: unknown;
  toolResult?: unknown;
  isError?: boolean;
  isThought?: boolean;
  author?: string | null;
}

export function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Map internal type to display role */
export function typeToRole(type: string): string {
  switch (type) {
    case "user":
      return "user";
    case "thought":
      return "assistant";
    case "assistant":
      return "assistant";
    case "tool_start":
      return "tool";
    case "tool_end":
      return "tool";
    default:
      return type;
  }
}

export function parseDbMessage(msg: DbMessage): ParsedMessage {
  try {
    const parsed = JSON.parse(msg.content);
    const role = typeToRole(msg.type);
    const isThought = msg.type === "thought";

    if (msg.type === "tool_start" || msg.type === "tool_end") {
      return {
        role: "tool",
        content: "",
        timestamp: msg.timestamp,
        toolName: parsed.toolName,
        toolPhase: msg.type === "tool_start" ? "start" : "end",
        toolArgs: parsed.args,
        toolResult: parsed.result,
        isError: parsed.isError,
      };
    }

    if (typeof parsed === "string") {
      return { role, content: parsed, timestamp: msg.timestamp, isThought, author: msg.author };
    }

    const attachments = parsed.attachments?.map((a: Attachment) => ({
      ...a,
      url: a.url || (a.path ? `/attachments/${a.path.split("/").pop()}` : undefined),
    }));
    return {
      role,
      content: parsed.text || parsed.content || "",
      timestamp: msg.timestamp,
      attachments,
      isThought,
      author: msg.author,
    };
  } catch {
    return {
      role: typeToRole(msg.type),
      content: msg.content,
      timestamp: msg.timestamp,
      isThought: msg.type === "thought",
      author: msg.author,
    };
  }
}

export interface FilterState {
  showThoughts: boolean;
  showTools: boolean;
}
