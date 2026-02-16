#!/usr/bin/env npx ts-node --esm
/**
 * Test script for the PiHarness
 * Run with: npx tsx src/harnesses/test-harness.ts
 */

import { PiHarness } from "./pi-coding-agent/index.js";
import type { NormalizedEvent } from "./types.js";

async function main() {
  console.log("=== PiHarness Test ===\n");

  const harness = new PiHarness({
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    },
    thinkingLevel: "off",
  });

  const systemPrompt = `You are a helpful assistant. Keep responses brief.`;
  const userMessage = `What is 2 + 2? Answer in one word.`;

  console.log("System prompt:", systemPrompt);
  console.log("User message:", userMessage);
  console.log("\n--- Running ---\n");

  const rawEvents: unknown[] = [];
  const normalizedEvents: NormalizedEvent[] = [];

  try {
    await harness.run(
      systemPrompt,
      userMessage,
      {
        onRawEvent: (event) => {
          rawEvents.push(event);
          const e = event as { type?: string };
          console.log(`[RAW] ${e.type || "unknown"}`);
        },
        onNormalizedEvent: (event) => {
          normalizedEvents.push(event);
          console.log(`[NORM] ${event.kind}:`, 
            event.kind === "assistant" ? event.content.slice(0, 50) + "..." :
            event.kind === "tool_start" ? `${event.tool}(...)` :
            event.kind === "tool_end" ? `${event.tool} -> ${event.success ? "ok" : "err"}` :
            event.kind === "error" ? event.message : "?"
          );
        },
      }
    );
  } catch (err) {
    console.error("\n[ERROR]", err);
  }

  console.log("\n--- Summary ---");
  console.log(`Raw events: ${rawEvents.length}`);
  console.log(`Normalized events: ${normalizedEvents.length}`);
  
  // Show final assistant message if any
  const assistantMsgs = normalizedEvents.filter(e => e.kind === "assistant");
  if (assistantMsgs.length > 0) {
    const last = assistantMsgs[assistantMsgs.length - 1];
    if (last.kind === "assistant") {
      console.log(`\nFinal response: "${last.content}"`);
    }
  }
}

main().catch(console.error);
