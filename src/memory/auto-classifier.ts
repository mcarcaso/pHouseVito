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

import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import type { ModelChoice } from "../types.js";

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
      "Cheapest, fastest. Pick for chit-chat, greetings, one-line factual questions, simple lookups, and anything that doesn't need real reasoning.",
  },
  {
    provider: "openrouter",
    name: "anthropic/claude-sonnet-4.6",
    description:
      "Balanced default. Pick for normal coding help, everyday conversations, moderate reasoning, and most typical requests.",
  },
  {
    provider: "openrouter",
    name: "anthropic/claude-opus-4.6",
    description:
      "Most capable, most expensive. Pick only for genuinely hard reasoning, large refactors, ambiguous multi-step planning, or when earlier attempts have failed.",
  },
];

/** Which fields the orchestrator wants decided. */
export interface AutoClassifierRequest {
  /** The raw user message for this turn. */
  userMessage: string;
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
    recalledMemoryLimit?: boolean;
  };
}

/** Fields returned by the classifier (only populated for ones that were needed). */
export interface AutoClassifierResult {
  /** The chosen model as a {provider, name} pair. */
  selectedModel?: { provider: string; name: string };
  currentContextLimit?: number;
  currentContextIncludeThoughts?: boolean;
  currentContextIncludeTools?: boolean;
  recalledMemoryLimit?: number;
  /** True if the classifier call actually ran and produced values. */
  ran: boolean;
  /** Reason if the classifier didn't run or fell back. */
  note?: string;
  /** Total time spent on the classifier call, ms. */
  durationMs: number;
}

const CLASSIFIER_PROVIDER = "anthropic" as const;
const CLASSIFIER_MODEL = "claude-haiku-4-5" as const;

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
      `- "currentContextLimit": integer 0-300. How many of the most recent messages from THIS session to include. Use 20-40 for simple/standalone messages, 80-120 for normal follow-ups, 150-250 if the user is clearly referring back to earlier conversation.`,
    );
  }
  if (req.needed.currentContextIncludeThoughts) {
    fieldDescriptions.push(
      `- "currentContextIncludeThoughts": boolean. Include the assistant's prior thinking/reasoning steps. True if the user is asking about how/why the assistant did something; false otherwise.`,
    );
  }
  if (req.needed.currentContextIncludeTools) {
    fieldDescriptions.push(
      `- "currentContextIncludeTools": boolean. Include prior tool calls and results. True if the user is asking about past actions, files, commands, or tool output; false otherwise.`,
    );
  }
  if (req.needed.recalledMemoryLimit) {
    fieldDescriptions.push(
      `- "recalledMemoryLimit": integer 0-10. How many semantically-recalled memory chunks to inject. 0 for chit-chat, 2-3 for normal, 5-8 for questions that seem to reference history ("last time", "remember when", "you mentioned").`,
    );
  }

  const systemPrompt = `You classify an incoming user message for an AI assistant harness. Given the message (and optional recent history), decide values for ONLY the fields listed below. Respond with a single JSON object, no prose, no markdown fences.

Fields to decide:
${fieldDescriptions.join("\n")}

Only include keys for the fields listed above. Any extra keys will be ignored.`;

  const userContent = req.recentHistory
    ? `<recent-history>\n${req.recentHistory}\n</recent-history>\n\n<user-message>\n${req.userMessage}\n</user-message>`
    : `<user-message>\n${req.userMessage}\n</user-message>`;

  const messages: Message[] = [
    {
      role: "user",
      content: userContent,
      timestamp: Date.now(),
    },
  ];

  try {
    const model = getModel(CLASSIFIER_PROVIDER, CLASSIFIER_MODEL);
    const assistantMsg = await completeSimple(model, {
      systemPrompt,
      messages,
    });

    // Extract text from assistant content blocks.
    let text = "";
    for (const block of assistantMsg.content) {
      if (block.type === "text") text += block.text;
    }
    text = text.trim();

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
    };

    if (req.needed.model && typeof parsed.modelIndex === "number") {
      const idx = Math.round(parsed.modelIndex);
      if (idx >= 0 && idx < modelChoices.length) {
        const choice = modelChoices[idx];
        result.selectedModel = { provider: choice.provider, name: choice.name };
      }
    }
    if (req.needed.currentContextLimit && typeof parsed.currentContextLimit === "number") {
      result.currentContextLimit = Math.max(0, Math.min(300, Math.round(parsed.currentContextLimit)));
    }
    if (req.needed.currentContextIncludeThoughts && typeof parsed.currentContextIncludeThoughts === "boolean") {
      result.currentContextIncludeThoughts = parsed.currentContextIncludeThoughts;
    }
    if (req.needed.currentContextIncludeTools && typeof parsed.currentContextIncludeTools === "boolean") {
      result.currentContextIncludeTools = parsed.currentContextIncludeTools;
    }
    if (req.needed.recalledMemoryLimit && typeof parsed.recalledMemoryLimit === "number") {
      result.recalledMemoryLimit = Math.max(0, Math.min(10, Math.round(parsed.recalledMemoryLimit)));
    }

    return result;
  } catch (err) {
    return {
      ran: false,
      note: `classifier failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startTime,
    };
  }
}
