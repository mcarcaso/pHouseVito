import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { Context } from "../../../context/Context.js";
import { xDriveDir, xDriveStore, xOrchestratorService, xSecretService } from "../../../lib/x.js";
import type { AgentActivityEvent, OutputHandler } from "../../../lib/output/OutputHandler.js";
import type { Attachment, InboundEvent } from "../../../lib/types/inbound-event.js";
import type { ChannelService, InboundEventHandler, ChannelUnsubscribe } from "../ChannelService.js";

const BASE = "https://api.whatsapp.com/agent/v1";
const CURSOR_PATH = resolve("user/whatsapp-agent-offset.json");
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

type Message = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
};
type Updates = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Message[];
      };
    }>;
  }>;
  next_offset?: number;
};

export class WhatsAppAgentChannelService implements ChannelService {
  readonly name = "whatsapp";
  readonly capabilities = { typing: true, reactions: false, attachments: true, streaming: false };
  private token = "";
  private running = false;
  private controller?: AbortController;
  private task?: Promise<void>;
  private offset?: number;
  private startedAt = 0;
  private readonly pending = new Set<Promise<void>>();

  async start(x: Context): Promise<void> {
    const token = xSecretService(x).get(x, "WHATSAPP_AGENT_API_KEY");
    if (!token) throw new Error("WHATSAPP_AGENT_API_KEY is not set");
    this.token = token;
    if (existsSync(CURSOR_PATH)) {
      const saved: unknown = JSON.parse(readFileSync(CURSOR_PATH, "utf8"));
      if (
        typeof saved === "object" &&
        saved !== null &&
        "offset" in saved &&
        Number.isSafeInteger(saved.offset) &&
        (saved.offset as number) >= 0
      )
        this.offset = saved.offset as number;
    }
    this.startedAt = Date.now();
    this.running = true;
  }

  async stop(_x: Context): Promise<void> {
    this.running = false;
    this.controller?.abort();
    await this.task;
    this.task = undefined;
  }

  listen(x: Context, onEvent: InboundEventHandler): Promise<ChannelUnsubscribe> {
    this.task = this.poll(x, onEvent);
    return Promise.resolve(() => {
      this.running = false;
      this.controller?.abort();
    });
  }

  createOutputHandler(_x: Context, event: InboundEvent): OutputHandler {
    let buffer = "";
    let lastId =
      typeof (event.raw as { messageId?: unknown })?.messageId === "string"
        ? (event.raw as { messageId: string }).messageId
        : undefined;
    let typingTimer: ReturnType<typeof setInterval> | undefined;
    const typing = async () => {
      if (!lastId) return;
      await this.request("/statuses", {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: lastId,
          typing_indicator: { type: "text" },
        }),
      }).catch(() => {});
    };
    const flush = async () => {
      if (!buffer) return;
      const text = buffer;
      buffer = "";
      const marker = /^MEDIA:(.+)$/gm;
      let start = 0;
      let match: RegExpExecArray | null;
      const sendText = async (part: string) => {
        for (let i = 0; i < part.length; i += 4096) {
          await this.request("/messages", {
            method: "POST",
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: event.target,
              type: "text",
              text: { body: part.slice(i, i + 4096) },
            }),
          });
        }
      };
      while ((match = marker.exec(text))) {
        if (text.slice(start, match.index).trim())
          await sendText(text.slice(start, match.index).trim());
        await this.sendMedia(event.target, match[1].trim());
        start = marker.lastIndex;
      }
      if (text.slice(start).trim()) await sendText(text.slice(start).trim());
    };
    return {
      relay: async (message) => {
        buffer += message;
      },
      relayEvent: async (_activity: AgentActivityEvent) => {},
      startTyping: async () => {
        await typing();
        if (!typingTimer) typingTimer = setInterval(() => void typing(), 22_000);
      },
      stopTyping: async () => {
        if (typingTimer) clearInterval(typingTimer);
        typingTimer = undefined;
        await flush();
      },
      endMessage: flush,
    };
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: options.signal ?? AbortSignal.timeout(35_000),
    });
    if (!response.ok && response.status !== 204)
      throw new Error(`WhatsApp agent API HTTP ${response.status}`);
    return response;
  }

  private async sendMedia(target: string, supplied: string): Promise<void> {
    const root = realpathSync(resolve("user/drive"));
    const path = realpathSync(resolve(supplied));
    const rel = relative(root, path);
    if (
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      statSync(path).size > 16 * 1024 * 1024
    )
      throw new Error("WhatsApp media must be a file in Drive under 16 MB");
    const name = basename(path);
    const ext = name.split(".").pop()?.toLowerCase();
    const mime = (
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        mp4: "video/mp4",
        mp3: "audio/mpeg",
        ogg: "audio/ogg",
        pdf: "application/pdf",
      } as Record<string, string>
    )[ext ?? ""];
    if (!mime) throw new Error("Unsupported WhatsApp media format");
    const bytes = readFileSync(path);
    // Image generators sometimes write JPEG bytes to a .png path. WhatsApp rejects a
    // mismatched MIME type; use the actual file signature for image uploads.
    const actualMime = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      ? "image/png"
      : bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
        ? "image/jpeg"
        : mime;
    const uploadName =
      actualMime === "image/jpeg"
        ? name.replace(/\.[^.]+$/, ".jpg")
        : actualMime === "image/png"
          ? name.replace(/\.[^.]+$/, ".png")
          : name;
    const kind = actualMime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : "document";
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([bytes], { type: actualMime }), uploadName);
    const upload = await this.request("/media", { method: "POST", body: form });
    const result = (await upload.json()) as { id?: string };
    if (!result.id) throw new Error("WhatsApp media upload returned no ID");
    await this.request("/messages", {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: target,
        type: kind,
        [kind]: { id: result.id, ...(kind === "document" ? { filename: uploadName } : {}) },
      }),
    });
  }

  private async receiveMedia(x: Context, message: Message): Promise<Attachment | undefined> {
    const kind = message.type;
    if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "document") return;
    const media = message[kind];
    if (!media?.id) return;
    const metadata = await this.request(`/media/${encodeURIComponent(media.id)}`);
    const info = (await metadata.json()) as { url?: string; mime_type?: string };
    if (!info.url) throw new Error("WhatsApp media metadata has no download URL");
    const url = new URL(info.url);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)(facebook\.com|fbcdn\.net|fbsbx\.com|whatsapp\.net)$/.test(url.hostname)
    )
      throw new Error("Untrusted WhatsApp media download URL");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error(`WhatsApp media download HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("WhatsApp media download has no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) throw new Error("WhatsApp media exceeds 16 MB");
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const ext =
      (
        {
          "image/jpeg": ".jpg",
          "image/png": ".png",
          "video/mp4": ".mp4",
          "audio/ogg": ".ogg",
          "audio/mpeg": ".mp3",
          "application/pdf": ".pdf",
        } as Record<string, string>
      )[info.mime_type ?? media.mime_type ?? ""] ?? "";
    const name = `${Date.now()}_${randomBytes(4).toString("hex")}${ext}`;
    const entry = xDriveStore(x).create(x, {
      kind: "file",
      path: `images/${name}`,
      content: bytes,
    });
    return {
      type: kind === "document" ? "file" : kind,
      path: resolve(xDriveDir(x), entry.path),
      mimeType: info.mime_type ?? media.mime_type,
      filename: kind === "document" ? (message.document?.filename ?? name) : name,
    };
  }

  private saveOffset(offset: number): void {
    mkdirSync(dirname(CURSOR_PATH), { recursive: true });
    const temp = `${CURSOR_PATH}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ offset }), { mode: 0o600 });
    renameSync(temp, CURSOR_PATH);
    this.offset = offset;
  }

  private async poll(x: Context, onEvent: InboundEventHandler): Promise<void> {
    let delay = 1_000;
    while (this.running) {
      this.controller = new AbortController();
      try {
        const query = new URLSearchParams({ limit: "50", timeout: "15" });
        if (this.offset !== undefined) query.set("offset", String(this.offset));
        // Scan retained updates on first boot but never reply to messages sent before startup.
        if (this.offset === undefined) query.set("offset", "0");
        const response = await this.request(`/updates?${query}`, {
          signal: this.controller.signal,
        });
        if (response.status === 204) continue;
        const updates = (await response.json()) as Updates;
        for (const entry of updates.entry ?? [])
          for (const change of entry.changes ?? []) {
            const names = new Map(
              (change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]),
            );
            for (const message of change.value?.messages ?? []) {
              if (!message.from.startsWith("user:")) continue;
              if (this.offset === undefined && Number(message.timestamp) * 1000 < this.startedAt)
                continue;
              const media =
                message.type === "text" ? undefined : await this.receiveMedia(x, message);
              const content =
                message.type === "text"
                  ? message.text?.body
                  : (message.image?.caption ??
                    message.video?.caption ??
                    message.document?.caption ??
                    "");
              if (!content && !media) continue;
              const event: InboundEvent = {
                sessionKey: `whatsapp:${message.from}`,
                channel: this.name,
                target: message.from,
                author: names.get(message.from) || "WhatsApp user",
                timestamp: Number(message.timestamp) * 1000 || Date.now(),
                content: content ?? "",
                attachments: media ? [media] : undefined,
                raw: { messageId: message.id },
                hasMention: true,
              };
              if (event.content.startsWith("/steer ")) {
                const steerEvent = { ...event, content: event.content.slice(7).trim() };
                if (steerEvent.content) {
                  const accepted = await xOrchestratorService(x).steer(x, steerEvent);
                  const handler = this.createOutputHandler(x, event);
                  await handler.relay(
                    accepted
                      ? "Steering the active turn."
                      : "No active turn to steer. Send it as a regular message instead.",
                  );
                  await handler.endMessage?.();
                }
                continue;
              }
              // Don't block polling on a long-running turn: steering and /stop must remain reachable.
              // The orchestrator serializes ordinary turns within the session.
              while (this.pending.size >= 100) await Promise.race(this.pending);
              const task = Promise.resolve().then(() => onEvent(event));
              const tracked = task.then(
                () => {},
                (error) => console.error("[WhatsApp] Inbound processing failed:", error),
              );
              this.pending.add(tracked);
              void tracked.finally(() => this.pending.delete(tracked));
            }
          }
        if (Number.isSafeInteger(updates.next_offset) && updates.next_offset! >= 0)
          this.saveOffset(updates.next_offset!);
        delay = 1_000;
      } catch (error) {
        if (!this.running) break;
        console.error("[WhatsApp] Poll failed:", error);
        await wait(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }
}
