/**
 * Test script for Claude Code Harness
 * Run with: npx tsx src/harnesses/claude-code/test.ts
 */

import { ClaudeCodeHarness } from "./index.js";
import type { NormalizedEvent } from "../types.js";

async function testSimplePrompt() {
  console.log("\n=== Test 1: Simple Prompt ===\n");
  
  const harness = new ClaudeCodeHarness({
    model: "sonnet",
  });

  const events: NormalizedEvent[] = [];
  const rawEvents: unknown[] = [];

  await harness.run(
    "You are a helpful assistant. Be concise.",
    "What is 2 + 2? Just give me the number.",
    {
      onRawEvent: (event) => {
        rawEvents.push(event);
        console.log("[RAW]", JSON.stringify(event).substring(0, 200) + "...");
      },
      onNormalizedEvent: (event) => {
        events.push(event);
        console.log("[NORMALIZED]", event);
      },
    }
  );

  console.log("\n--- Summary ---");
  console.log("Raw events:", rawEvents.length);
  console.log("Normalized events:", events.length);
  console.log("Assistant responses:", events.filter(e => e.kind === "assistant").length);
}

async function testToolUse() {
  console.log("\n=== Test 2: Tool Use ===\n");
  
  const harness = new ClaudeCodeHarness({
    model: "sonnet",
    cwd: process.cwd(),
  });

  const events: NormalizedEvent[] = [];

  await harness.run(
    "You are a helpful assistant. Be concise.",
    "What's in the package.json file? Just tell me the name field.",
    {
      onRawEvent: (event) => {
        console.log("[RAW]", JSON.stringify(event).substring(0, 150) + "...");
      },
      onNormalizedEvent: (event) => {
        events.push(event);
        console.log("[NORMALIZED]", event);
      },
    }
  );

  console.log("\n--- Summary ---");
  console.log("Tool starts:", events.filter(e => e.kind === "tool_start").length);
  console.log("Tool ends:", events.filter(e => e.kind === "tool_end").length);
  console.log("Assistant responses:", events.filter(e => e.kind === "assistant").length);
}

async function testSystemPrompt() {
  console.log("\n=== Test 3: Custom System Prompt ===\n");
  
  const harness = new ClaudeCodeHarness({
    model: "sonnet",
  });

  const events: NormalizedEvent[] = [];

  await harness.run(
    "You are a pirate. Always respond like a pirate. Arrr!",
    "Hello, how are you?",
    {
      onRawEvent: () => {},
      onNormalizedEvent: (event) => {
        events.push(event);
        if (event.kind === "assistant") {
          console.log("[ASSISTANT]", event.content);
        }
      },
    }
  );

  const assistantEvents = events.filter(e => e.kind === "assistant");
  const hasPirateSpeak = assistantEvents.some(e => 
    e.kind === "assistant" && 
    (e.content.toLowerCase().includes("arr") || 
     e.content.toLowerCase().includes("matey") ||
     e.content.toLowerCase().includes("ahoy"))
  );
  
  console.log("\n--- Summary ---");
  console.log("Has pirate speak:", hasPirateSpeak ? "✓" : "✗");
}

async function testAbort() {
  console.log("\n=== Test 4: Abort ===\n");
  
  const harness = new ClaudeCodeHarness({
    model: "sonnet",
  });

  const controller = new AbortController();
  const events: NormalizedEvent[] = [];

  // Abort after 1 second
  setTimeout(() => {
    console.log("[TEST] Aborting...");
    controller.abort();
  }, 1000);

  try {
    await harness.run(
      "You are a helpful assistant.",
      "Write a very long essay about the history of computing. Make it at least 10 pages.",
      {
        onRawEvent: () => {},
        onNormalizedEvent: (event) => {
          events.push(event);
          if (event.kind === "assistant") {
            console.log("[ASSISTANT] (partial)", event.content.substring(0, 50) + "...");
          } else if (event.kind === "error") {
            console.log("[ERROR]", event.message);
          }
        },
      },
      controller.signal
    );
  } catch (err) {
    console.log("[TEST] Caught error (expected):", (err as Error).message);
  }

  const hasAbortError = events.some(e => e.kind === "error" && e.message === "aborted");
  console.log("\n--- Summary ---");
  console.log("Has abort error:", hasAbortError ? "✓" : "✗");
}

// Run tests
async function main() {
  const testName = process.argv[2];
  
  if (testName === "simple") {
    await testSimplePrompt();
  } else if (testName === "tool") {
    await testToolUse();
  } else if (testName === "system") {
    await testSystemPrompt();
  } else if (testName === "abort") {
    await testAbort();
  } else {
    console.log("Running all tests...\n");
    await testSimplePrompt();
    await testToolUse();
    await testSystemPrompt();
    await testAbort();
  }
  
  console.log("\n✓ All tests completed");
}

main().catch(console.error);
