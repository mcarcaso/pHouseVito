import type { AgentActivity, AgentActivityEvent } from "./OutputHandler.js";

export interface ProgressTransport {
  sendProgress(text: string): Promise<unknown>;
  editProgress(handle: unknown, text: string): Promise<void>;
  deleteProgress(handle: unknown): Promise<void>;
}

const labels: Record<AgentActivity, string> = {
  thinking: "Thinking",
  reading: "Reading",
  writing: "Writing",
  executing: "Executing",
  delegating: "Delegating",
  tool: "Using tool",
  responding: "Responding",
  finishing: "Finishing",
};
const tools: Record<string, string> = {
  read: "Read file",
  write: "Write file",
  edit: "Edit file",
  bash: "Run command",
  delegation_run: "Delegate task",
  delegation_wait: "Wait for delegate",
  web_search: "Search web",
  web_fetch: "Fetch web page",
};
function toolName(name?: string): string {
  const clean = (name ?? "tool")
    .replace(/[^a-zA-Z0-9_.:-]+/g, " ")
    .trim()
    .slice(0, 80);
  return (
    tools[clean] ??
    clean
      .replace(/^(functions|multi_tool_use)[._]/, "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 60)
  );
}
function toolActivity(name?: string): AgentActivity {
  switch (name?.replace(/[^a-zA-Z0-9_.:-]+/g, " ").trim()) {
    case "read":
      return "reading";
    case "write":
    case "edit":
      return "writing";
    case "bash":
      return "executing";
    case "delegation_run":
    case "delegation_wait":
      return "delegating";
    default:
      return "tool";
  }
}

/** Shared, best-effort ephemeral progress lifecycle; transport owns the message API. */
export class ProgressPresenter {
  private readonly startedAt = Date.now();
  private summary?: string;
  private visible = false;
  private activity: AgentActivity = "thinking";
  private count = 0;
  private work: Array<{ id: string; name: string; status: "running" | "completed" | "failed" }> =
    [];
  private handle: unknown;
  private timer?: ReturnType<typeof setTimeout>;
  private updatedAt = 0;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: ProgressTransport,
    private readonly conversationUrl?: string | (() => string),
    private readonly formatConversationLink: (url: string) => string = (url) =>
      `Open conversation: ${url}`,
  ) {}

  async onEvent(event: AgentActivityEvent): Promise<void> {
    if (this.closed) return;
    if (event.kind === "thinking") {
      if (event.activity) this.activity = event.activity;
      if (event.content?.trim()) {
        this.summary = event.content.trim().slice(0, 300);
        this.visible = true;
      }
    } else if (event.kind === "tool_start") {
      this.visible = true;
      this.activity = toolActivity(event.toolName);
      this.count++;
      this.work.push({
        id: (event.toolCallId ?? `${this.count}`).slice(0, 200),
        name: toolName(event.toolName),
        status: "running",
      });
      this.work = this.work.slice(-5);
    } else {
      this.activity = "thinking";
      const item = this.work
        .slice()
        .reverse()
        .find((w) => w.id === event.toolCallId?.slice(0, 200));
      if (item) item.status = event.isError ? "failed" : "completed";
    }
    if (!this.visible) return;
    const delay = Math.max(0, 2_000 - (Date.now() - this.updatedAt));
    if (delay && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.update();
      }, delay);
      return;
    }
    if (!delay) await this.update();
  }

  private text(): string {
    const seconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1_000));
    const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const url =
      typeof this.conversationUrl === "function" ? this.conversationUrl() : this.conversationUrl;
    return [
      `⏳ ${this.summary ?? "Working…"}`,
      [
        duration,
        labels[this.activity],
        this.count ? `${this.count} tool${this.count === 1 ? "" : "s"}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      ...this.work
        .slice(-4)
        .map(
          (w) =>
            `${w.status === "running" ? "◌" : w.status === "failed" ? "✕" : "✓"} ${w.name}${w.status === "running" ? "…" : ""}`,
        ),
      ...(url ? [this.formatConversationLink(url)] : []),
    ].join("\n");
  }

  private async update(): Promise<void> {
    if (this.closed || !this.visible) return;
    const text = this.text();
    this.pending = this.pending.then(async () => {
      if (this.closed || !this.visible) return;
      try {
        if (this.handle !== undefined) await this.transport.editProgress(this.handle, text);
        else this.handle = await this.transport.sendProgress(text);
        this.updatedAt = Date.now();
      } catch {
        /* Progress is optional; final delivery is authoritative. */
      }
    });
    await this.pending;
  }

  /** Commentary/final chunk boundary: remove the temporary card, but allow later updates. */
  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.summary = undefined;
    this.visible = false;
    await this.pending;
    if (this.handle !== undefined) await this.transport.deleteProgress(this.handle).catch(() => {});
    this.handle = undefined;
  }

  /** Entire turn is finished: no further progress events are accepted. */
  async close(): Promise<void> {
    this.closed = true;
    await this.clear();
  }
}
