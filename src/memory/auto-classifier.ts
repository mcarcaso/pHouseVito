/**
 * Per-field auto classifier.
 *
 * When a settings field has its `auto` flag enabled, we call a cheap LLM
 * (claude-haiku-4-5) with the user's message and a small history snippet
 * to decide a reasonable value for that field on this turn.
 *
 * The classifier is a single call that returns a JSON blob covering all
 * requested fields at once — we only prompt it about fields the orchestrator
 * actually asked for, and fall back to sensible defaults on any failure.
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { PiHarness } from "../harnesses/index.js";
import { buildPromptText } from "../types.js";
import type { Attachment, ModelChoice } from "../types.js";

/**
 * Default model the classifier itself runs on. Cheap + fast.
 * Users can override via settings.auto.classifierModel.
 */
export const DEFAULT_CLASSIFIER_MODEL = {
  provider: "anthropic",
  name: "claude-haiku-4-5",
} as const;

/**
 * Default candidates for the pi-coding-agent model auto-selection.
 * All routed through openrouter so a single provider/API key covers all tiers.
 * Users can override via settings.auto["pi-coding-agent"].modelChoices.
 */
export const DEFAULT_PI_MODEL_CHOICES: ModelChoice[] = [
  {
    provider: "openrouter",
    name: "anthropic/claude-haiku-4.5",
    description:
      "Smallest, fastest, cheapest — but capable enough for one-shot work. Pick when the message is a self-contained, well-scoped request: a small coding task with a clear ask (\"write a function that…\", \"regex for…\", \"convert this snippet\"), basic research or factual lookups, short explanations of a concept, greetings, acknowledgments (\"ok\", \"thanks\"). The defining test: the task can be answered in a single pass with no iteration, no need to hold repo context in mind, and low risk of subtly getting it wrong. If you're unsure between this and the middle tier, prefer the middle tier.",
  },
  {
    provider: "openrouter",
    name: "anthropic/claude-sonnet-4.6",
    description:
      "Middle tier — the default. Pick when the message needs more than a one-shot answer: tasks that touch real repo context (multi-file edits, edits that depend on the surrounding code), follow-ups in an ongoing coding session where prior turns matter, multi-step bug fixes where each step depends on the last, anything where getting it right requires holding several pieces in mind at once. Use this whenever the task is concrete but not trivially one-shot.",
  },
  {
    provider: "openrouter",
    name: "anthropic/claude-opus-4.6",
    description:
      "Top tier, most capable, most expensive. Pick only when the message genuinely needs deep reasoning: architectural decisions with tradeoffs, refactors spanning multiple files or changing interfaces, debugging without an obvious cause, open-ended planning (\"how should we…\"), or follow-ups where an earlier simpler attempt has already failed. If you're unsure between this and the middle tier, prefer the middle tier — only pick this when you can name a specific reason the cheaper model would struggle.",
  },
];

/** Which fields the orchestrator wants decided. */
export interface AutoClassifierRequest {
  /** The raw user message for this turn. */
  userMessage: string;
  /** Author of the message (optional, used for trace formatting). */
  author?: string;
  /** Attachments on the message (optional). */
  attachments?: Attachment[];
  /** A short chronological snippet of the recent turn history (optional). */
  recentHistory?: string;
  /** Candidate models — required when needed.model is true. */
  modelChoices?: ModelChoice[];
  /** Which fields should be decided by the classifier. */
  needed: {
    model?: boolean;
    currentContextLimit?: boolean;
    currentContextIncludeThoughts?: boolean;
    currentContextIncludeTools?: boolean;
    crossContextLimit?: boolean;
    crossContextMaxSessions?: boolean;
    recalledMemoryLimit?: boolean;
  };
  /** Which model the classifier should run on. Defaults to DEFAULT_CLASSIFIER_MODEL. */
  classifierModel?: { provider: string; name: string };
  /** Identifying info for the trace file header. */
  trace?: {
    session_id: string;
    channel: string;
    target: string;
  };
}

/** Fields returned by the classifier (only populated for ones that were needed). */
export interface AutoClassifierResult {
  /** The chosen model as a {provider, name} pair. */
  selectedModel?: { provider: string; name: string };
  currentContextLimit?: number;
  currentContextIncludeThoughts?: boolean;
  currentContextIncludeTools?: boolean;
  crossContextLimit?: number;
  crossContextMaxSessions?: number;
  recalledMemoryLimit?: number;
  /** Classifier's own explanation of why it picked these values. */
  explanation?: string;
  /** True if the classifier call actually ran and produced values. */
  ran: boolean;
  /** Reason if the classifier didn't run or fell back. */
  note?: string;
  /** Total time spent on the classifier call, ms. */
  durationMs: number;
  /** Path to the JSONL trace file written for this call (if any). */
  tracePath?: string;
}


/**
 * Open a fresh trace file for a single classifier call.
 * Returns the path and a writeLine helper. Returns null if no trace info
 * was provided (caller wants to skip tracing for this run).
 */
function openTraceFile(
  trace: AutoClassifierRequest["trace"],
): { path: string; writeLine: (obj: unknown) => void } | null {
  if (!trace) return null;
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  const path = join("logs", `trace-classifier-${timestamp}-${suffix}.jsonl`);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // best-effort
  }
  const writeLine = (obj: unknown) => {
    try {
      appendFileSync(path, JSON.stringify(obj) + "\n");
    } catch (err) {
      // Tracing must never break the classifier — swallow.
      console.warn(`[AutoClassifier] failed to write trace line: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return { path, writeLine };
}

/**
 * Run the auto classifier. Always returns — on any failure, `ran` is false
 * and no decision fields are populated (orchestrator should fall back to
 * the configured/default values).
 */
export async function runAutoClassifier(req: AutoClassifierRequest): Promise<AutoClassifierResult> {
  const startTime = Date.now();

  // Short-circuit if nothing is needed.
  const anyNeeded = Object.values(req.needed).some(Boolean);
  if (!anyNeeded) {
    return { ran: false, note: "no fields needed", durationMs: 0 };
  }

  // Resolve model choices if model picking is requested.
  const modelChoices = req.needed.model
    ? (req.modelChoices && req.modelChoices.length > 0 ? req.modelChoices : DEFAULT_PI_MODEL_CHOICES)
    : [];

  // Build the instruction. We describe each requested field and ask for JSON.
  const fieldDescriptions: string[] = [];
  if (req.needed.model) {
    const choiceLines = modelChoices
      .map((c, i) => `    ${i}: ${c.provider}/${c.name} — ${c.description}`)
      .join("\n");
    fieldDescriptions.push(
      `- "modelIndex": integer, the 0-based index of the chosen model from this list:\n${choiceLines}`,
    );
  }
  if (req.needed.currentContextLimit) {
    fieldDescriptions.push(
      `- "currentContextLimit": integer 5-300. How many of the most recent messages from THIS session to include in the response context. The recent-history block tags each line with [-K], its distance from the new message ([-1] = just before it). Pick the smallest N such that messages [-N] through [-1] still cover everything relevant to the new user message. The minimum is 5 — even if the topic has fully shifted, return 5 (don't bother trying to return less). Return roughly the visible window size if everything shown still looks relevant. Return larger than the visible window only when the new message clearly references something further back than what you can see.`,
    );
  }
  if (req.needed.currentContextIncludeThoughts) {
    fieldDescriptions.push(
      `- "currentContextIncludeThoughts": boolean. Include the assistant's prior reasoning/thinking blocks in the response context. These are large, so only keep them when the new message asks the assistant to explain, justify, revisit, or continue past reasoning — phrases like "why did you", "what were you thinking", "go back to your plan", "you said X, explain" — OR when the conversation is an iterative software-building/debugging session where the assistant is mid-task and needs its own prior thought process to continue coherently. Default to false for new topics, chit-chat, and anything that doesn't reference the assistant's past thinking. In practice this usually matches currentContextIncludeTools — if one is true, the other probably is too.`,
    );
  }
  if (req.needed.currentContextIncludeTools) {
    fieldDescriptions.push(
      `- "currentContextIncludeTools": boolean. Include prior tool calls and their results (file reads, command output, search results, etc.) in the response context. These are large, so only keep them when the new message leans on past tool work — asking about a file the assistant read, output from a command it ran, search results, follow-ups on something it fetched or wrote — OR when the conversation is an iterative software-building/debugging session where the assistant needs its prior tool output to keep working on the same task. Default to false for new topics, chit-chat, or anything that doesn't reference past tool output. In practice this usually matches currentContextIncludeThoughts.`,
    );
  }
  if (req.needed.crossContextLimit) {
    fieldDescriptions.push(
      `- "crossContextLimit": integer 0-10. How many messages per OTHER session to include. Cross-session context is expensive and should usually be near zero. Pick 0 for standalone requests, routine follow-ups in the current thread, and operational tasks that don't need outside sessions. Pick 1-2 when a little outside context might help. Pick 3-6 only when the user is clearly asking about prior work across sessions, patterns over time, or comparisons with earlier conversations.`,
    );
  }
  if (req.needed.crossContextMaxSessions) {
    fieldDescriptions.push(
      `- "crossContextMaxSessions": integer 0-20. How many OTHER sessions may contribute cross-session context. 0 means no cross-session context at all. For most requests this should be 0-3. Only go above that when the user is explicitly asking for synthesis across many threads, history, or project-wide recall.`,
    );
  }
  if (req.needed.recalledMemoryLimit) {
    fieldDescriptions.push(
      `- "recalledMemoryLimit": integer 0-10. How many semantically-recalled memory chunks to inject. 0 for chit-chat and fresh standalone asks, 1-3 for normal personal continuity, 4-6 for memory-heavy questions that seem to reference history ("last time", "remember when", "you mentioned").`,
    );
  }

  const systemPrompt = `You classify an incoming user message for an AI assistant harness. Given the message (and optional recent history), decide values for ONLY the fields listed below. Respond with a single JSON object, no prose, no markdown fences.

Use this bounded policy as your guardrail:
- LEAN: standalone, procedural, one-shot, or routine operational requests. Keep context tight. Prefer current-session only. Cross-session should usually be 0. Memory should usually be 0-1.
- NORMAL: ordinary follow-ups in the same thread or tasks that need some nearby continuity. Keep enough current-session context to stay coherent. Cross-session should stay small unless the user clearly asks for it. Memory is usually 1-3.
- RICH: debugging, audits, comparisons, strategy, or explicit references to previous work across sessions. Use more current-session context, allow some cross-session context, and raise memory only when the user is clearly leaning on history.

Hard rules:
- Bias toward the smallest context that still safely answers the message.
- Cross-session context is the most expensive and easiest to over-inject. Do not include it unless the message actually benefits from other sessions.
- If the message is about "this trace", "this file", "today's task", or a direct follow-up in the same thread, prefer current-session context over cross-session context.
- Thoughts/tools should usually move together: if prior reasoning matters, prior tool output often matters too.

Fields to decide:
${fieldDescriptions.join("\n")}

You MUST also include:
- "explanation": string. Two to four short sentences explaining your reasoning for the values you chose. Reference the actual user message and recent history. Name the inferred mode (LEAN, NORMAL, or RICH). If you picked a model tier, say which trigger from its description matched. If you picked context values, say why this is standalone, a same-thread follow-up, or a cross-session/history-heavy request.

Only include the keys listed above plus "explanation". Any extra keys will be ignored.`;

  const formattedMessage = buildPromptText(req.userMessage, {
    author: req.author,
    attachments: req.attachments,
  });

  const userContent = req.recentHistory
    ? `<recent-history>\n${req.recentHistory}\n</recent-history>\n\n<user-message>\n${formattedMessage}\n</user-message>`
    : `<user-message>\n${formattedMessage}\n</user-message>`;

  // Resolve the classifier model (request override → default).
  const classifierModel = req.classifierModel?.provider && req.classifierModel.name
    ? req.classifierModel
    : DEFAULT_CLASSIFIER_MODEL;

  // Open the trace file (no-op if caller passed no trace info).
  const traceFile = openTraceFile(req.trace);
  if (traceFile && req.trace) {
    traceFile.writeLine({
      type: "header",
      timestamp: new Date().toISOString(),
      session_id: req.trace.session_id,
      channel: req.trace.channel,
      target: req.trace.target,
      model: `${classifierModel.provider}/${classifierModel.name}`,
      harness: "auto-classifier",
    });
    traceFile.writeLine({
      type: "prompt",
      content: systemPrompt,
      length: systemPrompt.length,
    });
    traceFile.writeLine({
      type: "user_message",
      content: userContent,
    });
  }

  // Helper used by both success and failure paths to close the trace file.
  let assistantText = "";
  let runError: string | undefined;
  let sawAssistantMessage = false;
  let toolCalls = 0;
  const finishTrace = () => {
    if (!traceFile) return;
    traceFile.writeLine({
      type: "footer",
      duration_ms: Date.now() - startTime,
      message_count: sawAssistantMessage ? 1 : 0,
      tool_calls: toolCalls,
      success: !runError,
      error: runError,
    });
  };

  try {
    const classifierHarness = new PiHarness({
      model: classifierModel,
      thinkingLevel: "off",
    });

    await classifierHarness.run(
      systemPrompt,
      userContent,
      {
        onInvocation: (cliCommand) => {
          traceFile?.writeLine({
            type: "invocation",
            command: cliCommand,
          });
        },
        onRawEvent: (event) => {
          traceFile?.writeLine({
            type: "raw_event",
            ts: Date.now() - startTime,
            event,
          });
        },
        onNormalizedEvent: (event) => {
          traceFile?.writeLine({
            type: "normalized_event",
            ts: Date.now() - startTime,
            event,
          });

          if (event.kind === "assistant" && event.content?.trim()) {
            assistantText = event.content.trim();
            sawAssistantMessage = true;
          } else if (event.kind === "tool_start") {
            toolCalls += 1;
          } else if (event.kind === "error") {
            runError = event.message;
          }
        },
      },
    );

    let text = assistantText.trim();

    // Strip code fences if the model added them despite the instruction.
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    // Try to find a JSON object in the text if there's leading/trailing prose.
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;

    const result: AutoClassifierResult = {
      ran: true,
      durationMs: Date.now() - startTime,
      tracePath: traceFile?.path,
    };

    if (req.needed.model && typeof parsed.modelIndex === "number") {
      const idx = Math.round(parsed.modelIndex);
      if (idx >= 0 && idx < modelChoices.length) {
        const choice = modelChoices[idx];
        result.selectedModel = { provider: choice.provider, name: choice.name };
      }
    }
    if (req.needed.currentContextLimit && typeof parsed.currentContextLimit === "number") {
      result.currentContextLimit = Math.max(5, Math.min(300, Math.round(parsed.currentContextLimit)));
    }
    if (req.needed.currentContextIncludeThoughts && typeof parsed.currentContextIncludeThoughts === "boolean") {
      result.currentContextIncludeThoughts = parsed.currentContextIncludeThoughts;
    }
    if (req.needed.currentContextIncludeTools && typeof parsed.currentContextIncludeTools === "boolean") {
      result.currentContextIncludeTools = parsed.currentContextIncludeTools;
    }
    if (req.needed.crossContextLimit && typeof parsed.crossContextLimit === "number") {
      result.crossContextLimit = Math.max(0, Math.min(10, Math.round(parsed.crossContextLimit)));
    }
    if (req.needed.crossContextMaxSessions && typeof parsed.crossContextMaxSessions === "number") {
      result.crossContextMaxSessions = Math.max(0, Math.min(20, Math.round(parsed.crossContextMaxSessions)));
    }
    if (req.needed.recalledMemoryLimit && typeof parsed.recalledMemoryLimit === "number") {
      result.recalledMemoryLimit = Math.max(0, Math.min(10, Math.round(parsed.recalledMemoryLimit)));
    }
    if (typeof parsed.explanation === "string") {
      result.explanation = parsed.explanation.trim();
    }

    finishTrace();
    return result;
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    finishTrace();
    return {
      ran: false,
      note: `classifier failed: ${runError}`,
      durationMs: Date.now() - startTime,
      tracePath: traceFile?.path,
    };
  }
}
