import { PiHarness } from "../harnesses/index.js";
import { buildPromptText } from "../types.js";
import { extractMessageText } from "./context.js";
import type { Attachment, MessageRow } from "../types.js";

export interface ContextualizeQueryRequest {
  userMessage: string;
  author?: string;
  attachments?: Attachment[];
  recentMessages: MessageRow[];
  model: { provider: string; name: string };
}

export interface ContextualizeQueryResult {
  contextualQuery: string;
  searchText: string;
  durationMs: number;
  skipped?: string;
}

function formatRecentMessages(messages: MessageRow[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    try {
      const text = extractMessageText(msg.content);
      if (!text) continue;
      const role = msg.type === "user" ? "user" : "assistant";
      const speaker = msg.type === "user" && msg.author ? `${role} (${msg.author})` : role;
      lines.push(`${speaker}: ${text.slice(0, 700)}`);
    } catch {
      // Skip malformed rows. Contextualization is best-effort.
    }
  }
  return lines.join("\n\n");
}

/**
 * Rewrite a potentially contextless incoming message into a concise retrieval
 * query, then append the original message before embedding/searching. This is
 * for semantic search only — it is not injected into the final prompt by itself.
 */
export async function contextualizeSearchQuery(req: ContextualizeQueryRequest): Promise<ContextualizeQueryResult> {
  const start = Date.now();
  const originalMessage = buildPromptText(req.userMessage, {
    author: req.author,
    attachments: req.attachments,
  }).trim();

  if (!originalMessage) {
    return { contextualQuery: "", searchText: "", durationMs: Date.now() - start, skipped: "empty query" };
  }

  const recent = formatRecentMessages(req.recentMessages);
  if (!recent) {
    return { contextualQuery: "", searchText: originalMessage, durationMs: Date.now() - start, skipped: "no recent context" };
  }

  const systemPrompt = `You rewrite the latest user message into a concise semantic-retrieval query for a personal AI memory system.

Goal: explain what the user's message means in the context of the recent conversation so embedding search can find the right stored chunks.

Rules:
- Output only the rewritten retrieval query. No JSON, no bullets, no preamble.
- Write 1-3 sentences, maximum 90 words.
- Preserve concrete nouns, project names, files, settings, models, people, and the user's actual intent.
- Resolve vague references like "that", "it", "sounds good", "the other one" using recent conversation.
- Do not answer the user. Do not add facts not supported by the recent conversation or the latest message.`;

  const userContent = `Recent conversation before the latest user message:\n${recent}\n\nLatest user message:\n${originalMessage}`;

  try {
    const harness = new PiHarness({ model: req.model, thinkingLevel: "off" });
    let assistantText = "";
    await harness.run(systemPrompt, userContent, {
      onInvocation: () => {},
      onRawEvent: () => {},
      onNormalizedEvent: (event) => {
        if (event.kind === "assistant" && event.content?.trim()) {
          assistantText = event.content.trim();
        }
      },
    });

    const contextualQuery = assistantText
      .replace(/^```(?:text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!contextualQuery) {
      return {
        contextualQuery: "",
        searchText: originalMessage,
        durationMs: Date.now() - start,
        skipped: "empty contextualizer response",
      };
    }

    return {
      contextualQuery,
      searchText: `Contextual retrieval query:\n${contextualQuery}\n\nOriginal message:\n${originalMessage}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      contextualQuery: "",
      searchText: originalMessage,
      durationMs: Date.now() - start,
      skipped: `contextualizer failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
