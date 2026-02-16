#!/usr/bin/env npx ts-node --esm
/**
 * Compaction test - simulates the compaction use case
 * 
 * Compaction is just another harness.run() call with:
 * - A simple "summarize" system prompt (no tools, no personality)
 * - The messages to compact as the user message
 * 
 * Run with: npx tsx src/harnesses/compaction-test.ts
 */

import { resolve } from "path";
import { PiHarness } from "./pi-coding-agent/index.js";
import { withTracing } from "./proxy.js";
import type { NormalizedEvent } from "./types.js";

const USER_DIR = resolve(process.cwd(), "user");

async function main() {
  console.log("=== Compaction Test ===\n");

  // 1. Create harness with tracing - NO skills needed for compaction
  const innerHarness = new PiHarness({
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    },
    thinkingLevel: "off",
    // No skillsDir - compaction doesn't need tools
  });

  const harness = withTracing(innerHarness, {
    session_id: "compaction-test",
    channel: "test",
    target: "compaction",
    model: "anthropic/claude-sonnet-4-20250514",
  });

  console.log(`Harness: ${harness.getName()}`);
  console.log(`Trace: ${harness.tracePath}\n`);

  // 2. Compaction system prompt - simple, no tools
  const systemPrompt = `You are a conversation summarizer. Your job is to condense conversations while preserving:
- Key facts and decisions
- Important context
- User preferences discovered
- Any commitments or action items

Be concise but comprehensive. Output a summary paragraph, not a list.`;

  // 3. Fake conversation to compact (simulating what orchestrator would pull from DB)
  const messagesToCompact = `
[user] Hey Vito, what's the weather like?
[assistant] I don't have access to weather data, boss. But I can help you set up a weather skill if you want.
[user] Nah that's ok. Can you remind me about the meeting tomorrow at 3pm?
[assistant] Done. I'll ping you tomorrow at 2:45pm about your 3pm meeting. Capisce?
[user] Perfect. Also my wife's name is Sarah, remember that.
[assistant] Got it, boss. Sarah's in the memory banks now.
[user] Thanks Vito
[assistant] Anytime. That's what I'm here for. 🤌
`;

  const userMessage = `Summarize this conversation:\n${messagesToCompact}`;

  console.log("--- Input ---");
  console.log("System prompt:", systemPrompt.slice(0, 80) + "...");
  console.log("Messages to compact:", messagesToCompact.slice(0, 100) + "...");
  console.log("\n--- Running ---\n");

  // 4. Collect the summary
  let summary = "";
  const events: NormalizedEvent[] = [];

  try {
    await harness.run(
      systemPrompt,
      userMessage,
      {
        onRawEvent: () => {
          // Don't need to do anything with raw events for compaction
        },
        onNormalizedEvent: (event) => {
          events.push(event);
          if (event.kind === "assistant") {
            summary = event.content;
          }
        },
      }
    );
  } catch (err) {
    console.error("[FATAL ERROR]", err);
    return;
  }

  // 5. Show results
  console.log("--- Summary Output ---");
  console.log(summary);
  
  console.log("\n--- Stats ---");
  console.log(`Events: ${events.length}`);
  console.log(`Summary length: ${summary.length} chars`);
  
  // Verify no tool calls happened
  const toolEvents = events.filter(e => e.kind === "tool_start" || e.kind === "tool_end");
  if (toolEvents.length > 0) {
    console.log("⚠️  WARNING: Tool events detected in compaction (unexpected)");
  } else {
    console.log("✓ No tool calls (expected for compaction)");
  }
}

main().catch(console.error);
