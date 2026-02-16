#!/usr/bin/env npx ts-node --esm
/**
 * Abort test - make sure we can kill a run mid-flight
 * 
 * Run with: npx tsx src/harnesses/abort-test.ts
 */

import { resolve } from "path";
import { PiHarness } from "./pi-coding-agent/index.js";
import type { NormalizedEvent } from "./types.js";

async function main() {
  console.log("=== Abort Test ===\n");

  const harness = new PiHarness({
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    },
    thinkingLevel: "off",
    skillsDir: resolve(process.cwd(), "user/skills"),
  });

  // Create an abort controller
  const controller = new AbortController();

  // System prompt with a tool that takes time
  const systemPrompt = `You are a helpful assistant.
  
You have access to the Bash tool to run shell commands.`;
  const userMessage = `Run this command: sleep 10 && echo "done"`;

  console.log("Starting run...");
  console.log("Will abort after 2 seconds\n");

  const events: NormalizedEvent[] = [];
  let rawCount = 0;

  // Abort after 500ms 
  const abortTimer = setTimeout(() => {
    console.log("\n--- ABORTING ---\n");
    controller.abort();
  }, 500);

  const startTime = Date.now();

  try {
    await harness.run(
      systemPrompt,
      userMessage,
      {
        onRawEvent: (event) => {
          rawCount++;
          const e = event as { type?: string };
          if (e.type === "message_update") {
            process.stdout.write(".");
          }
        },
        onNormalizedEvent: (event) => {
          events.push(event);
          if (event.kind === "tool_start") {
            console.log(`[TOOL START] ${event.tool}`);
          } else if (event.kind === "tool_end") {
            console.log(`[TOOL END] ${event.tool}`);
          } else {
            console.log(`[EVENT] ${event.kind}`);
          }
        },
      },
      controller.signal
    );
    
    console.log("\nRun completed normally (unexpected - should have been aborted)");
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.log(`\nRun ended after ${elapsed}ms`);
    
    if (controller.signal.aborted) {
      console.log("✓ Aborted as expected");
    } else {
      console.log("✗ Error (not abort):", err);
    }
  } finally {
    clearTimeout(abortTimer);
  }

  console.log("\n--- Stats ---");
  console.log(`Raw events before abort: ${rawCount}`);
  console.log(`Normalized events: ${events.length}`);
  
  // Check if we got an error event for abort
  const errorEvents = events.filter(e => e.kind === "error");
  if (errorEvents.length > 0) {
    console.log(`Error events: ${errorEvents.map(e => e.kind === "error" ? e.message : "").join(", ")}`);
  }
}

main().catch(console.error);
