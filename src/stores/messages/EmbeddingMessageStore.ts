import type { Context } from "../../context/Context.js";
import { xEmbeddingStore, xMemoryIngestionService } from "../../lib/x.js";
import {
  formatMessageLine,
  MIN_CHUNK_CHARS,
  produceCompleteChunks,
  type IngestionCandidate,
  type RawMessage,
} from "../../services/memory/chunking.js";
import type {
  CreateMessageArgs,
  DeleteMessageArgs,
  MessageFilter,
  MessageListArgs,
  MessageRow,
  MessageStore,
  UpdateMessageArgs,
} from "./MessageStore.js";

interface FinalizeSessionCommand {
  type: "finalize-session";
  sessionIds: string[];
}

interface ArchiveSessionsCommand {
  type: "archive-sessions";
  sessionIds: string[];
}

function commandSessionIds(input: unknown, type: "finalize-session" | "archive-sessions") {
  if (!input || typeof input !== "object") return null;
  const command = input as { type?: unknown; sessionIds?: unknown };
  if (command.type !== type || !Array.isArray(command.sessionIds)) return null;
  const sessionIds = command.sessionIds.filter(
    (sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0,
  );
  return sessionIds.length === command.sessionIds.length ? sessionIds : null;
}

function isVoiceHandoff(message: MessageRow): boolean {
  if (message.author !== "Vito Voice") return false;
  try {
    const content = JSON.parse(message.content) as { voiceSession?: unknown };
    return content.voiceSession !== undefined;
  } catch {
    return false;
  }
}

export class EmbeddingMessageStore implements MessageStore {
  private readonly activeSessions = new Set<string>();
  private readonly pendingChecks = new Map<string, boolean>();

  constructor(private readonly inner: MessageStore) {}

  list(x: Context, args: MessageListArgs): MessageRow[] {
    return this.inner.list(x, args) as MessageRow[];
  }

  count(x: Context, args: MessageFilter): number {
    return this.inner.count(x, args) as number;
  }

  create(x: Context, args: CreateMessageArgs): MessageRow {
    const message = this.inner.create(x, args) as MessageRow;
    if (this.isIngestionBoundary("create", message)) this.kickoff(x, message.session_id, false);
    return message;
  }

  update(x: Context, args: UpdateMessageArgs): MessageRow {
    const message = this.inner.update(x, args) as MessageRow;
    if (this.isIngestionBoundary("update", message, args)) {
      this.kickoff(x, message.session_id, false);
    }
    return message;
  }

  delete(x: Context, args: DeleteMessageArgs): number {
    return this.inner.delete(x, args) as number;
  }

  cmd(x: Context, command: unknown): unknown {
    const finalized = commandSessionIds(command, "finalize-session");
    if (finalized) {
      for (const sessionId of finalized) this.kickoff(x, sessionId, true);
      return finalized.length;
    }

    const archived = commandSessionIds(command, "archive-sessions");
    const result = this.inner.cmd(x, command);
    if (archived) {
      for (const sessionId of archived) this.kickoff(x, sessionId, true);
    }
    return result;
  }

  private isIngestionBoundary(
    operation: "create" | "update",
    message: MessageRow,
    update?: UpdateMessageArgs,
  ): boolean {
    if (message.channel === "voice" || isVoiceHandoff(message)) return false;
    if (message.type !== "assistant") return false;
    return operation === "create" || update?.changes.type === "assistant";
  }

  private kickoff(x: Context, sessionId: string, force: boolean): void {
    if (this.activeSessions.has(sessionId)) {
      this.pendingChecks.set(sessionId, force || (this.pendingChecks.get(sessionId) ?? false));
      return;
    }

    try {
      const candidates = this.getIngestionCandidates(x, sessionId, force);
      if (candidates.length === 0) return;
      this.activeSessions.add(sessionId);
      void xMemoryIngestionService(x)
        .ingestCandidates(x, candidates)
        .then((result) => {
          this.activeSessions.delete(sessionId);
          const pendingForce = this.pendingChecks.get(sessionId);
          this.pendingChecks.delete(sessionId);
          if (result.embedding.chunks_created !== candidates.length) {
            console.error(
              `[Memory] Ingestion left candidates incomplete for ${sessionId}; they remain eligible for retry`,
            );
            return;
          }
          if (pendingForce !== undefined) this.kickoff(x, sessionId, pendingForce);
        })
        .catch((error) => {
          this.activeSessions.delete(sessionId);
          this.pendingChecks.delete(sessionId);
          console.error(`[Memory] Background ingestion failed for ${sessionId}:`, error);
        });
    } catch (error) {
      console.error(`[Memory] Failed to select ingestion candidates for ${sessionId}:`, error);
    }
  }

  private getIngestionCandidates(
    x: Context,
    sessionId: string,
    force: boolean,
  ): IngestionCandidate[] {
    const embeddingStore = xEmbeddingStore(x);
    const afterId = embeddingStore.getLastEmbeddedMessageId(x, sessionId);
    const messages: RawMessage[] = (
      this.inner.list(x, {
        sessionIds: [sessionId],
        afterId,
        excludeTypes: ["thought", "tool_start", "tool_end"],
        order: "oldest",
      }) as MessageRow[]
    )
      .filter((message) => message.type === "user" || message.type === "assistant")
      .map((message) => ({
        id: message.id,
        session_id: message.session_id,
        timestamp: message.timestamp,
        type: message.type,
        content: message.content,
        author: message.author,
      }));
    if (messages.length === 0) return [];

    let totalChars = 30;
    for (const message of messages) totalChars += formatMessageLine(message).length + 1;
    if (!force && totalChars < MIN_CHUNK_CHARS) return [];

    return produceCompleteChunks(
      messages,
      embeddingStore.getNextChunkIndices(x, sessionId),
      force,
    ).map((candidate) => ({ ...candidate, sessionId, initialAfterMessageId: afterId }));
  }
}

export type EmbeddingMessageStoreCommand = FinalizeSessionCommand | ArchiveSessionsCommand;
