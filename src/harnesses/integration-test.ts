#!/usr/bin/env npx ts-node --esm
/**
 * Integration test - simulates what the orchestrator will do
 * 
 * Tests:
 * 1. Building a system prompt (like orchestrator does)
 * 2. Running through the harness
 * 3. Getting normalized events back
 * 4. Tracing to a file
 * 
 * Run with: npx tsx src/harnesses/integration-test.ts
 */

import { resolve } from "path";
import { readFileSync } from "fs";
import { PiHarness } from "./pi-coding-agent/index.js";
import { withTracing } from "./tracing.js";
import type { NormalizedEvent } from "./types.js";

const USER_DIR = resolve(process.cwd(), "user");

async function main() {
  console.log("=== Integration Test ===\n");

  // 1. Create harness with tracing (like orchestrator will do at startup)
  const innerHarness = new PiHarness({
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    },
    thinkingLevel: "off",
    skillsDir: resolve(USER_DIR, "skills"),
  });

  const harness = withTracing(innerHarness, {
    session_id: "test-session",
    channel: "test",
    target: "integration",
    model: "anthropic/claude-sonnet-4-20250514",
  });

  console.log(`Harness: ${harness.getName()}`);
  console.log(`Trace: ${harness.tracePath}\n`);

  // 2. Build a system prompt (simplified version of what orchestrator does)
  const systemPrompt = `You are a helpful assistant.

You have access to the following tools:
- Read: Read a file from disk
- Bash: Execute a bash command

When asked to do something, do it directly.`;

  // 3. Build user message
  const userMessage = `What files are in the current directory? Just list the first 5.`;

  console.log("System prompt:", systemPrompt.slice(0, 100) + "...");
  console.log("User message:", userMessage);
  console.log("\n--- Running ---\n");

  // 4. Collect events (like orchestrator will do)
  const normalizedEvents: NormalizedEvent[] = [];
  let rawEventCount = 0;

  try {
    await harness.run(
      systemPrompt,
      userMessage,
      {
        onRawEvent: (event) => {
          rawEventCount++;
          // Orchestrator might stream to channel here based on event type
          const e = event as { type?: string };
          if (e.type === "message_update") {
            // Could stream text delta to user
          }
        },
        onNormalizedEvent: (event) => {
          normalizedEvents.push(event);
          
          // Log what we got
          switch (event.kind) {
            case "assistant":
              console.log(`[ASSISTANT] ${event.content.slice(0, 100)}...`);
              break;
            case "tool_start":
              console.log(`[TOOL START] ${event.tool}(${JSON.stringify(event.args).slice(0, 50)}...)`);
              break;
            case "tool_end":
              console.log(`[TOOL END] ${event.tool} -> ${event.success ? "✓" : "✗"}`);
              break;
            case "error":
              console.log(`[ERROR] ${event.message}`);
              break;
          }
        },
      }
    );
  } catch (err) {
    console.error("\n[FATAL ERROR]", err);
  }

  // 5. Summary
  console.log("\n--- Summary ---");
  console.log(`Raw events: ${rawEventCount}`);
  console.log(`Normalized events: ${normalizedEvents.length}`);
  
  // Show event breakdown
  const breakdown: Record<string, number> = {};
  for (const e of normalizedEvents) {
    breakdown[e.kind] = (breakdown[e.kind] || 0) + 1;
  }
  console.log("Breakdown:", breakdown);

  // 6. Verify trace file
  console.log("\n--- Trace File ---");
  try {
    const lines = readFileSync(harness.tracePath, "utf-8").trim().split("\n");
    console.log(`Lines written: ${lines.length}`);

    const header = JSON.parse(lines[0]);
    const footer = JSON.parse(lines[lines.length - 1]);

    console.log(`Header: harness=${header.harness}, session=${header.session_id}, model=${header.model}`);
    console.log(`Footer: duration=${footer.duration_ms}ms, messages=${footer.message_count}, tools=${footer.tool_calls}, error=${footer.error || "none"}`);
  } catch (err) {
    console.error("Failed to read trace:", err);
  }
}

main().catch(console.error);
