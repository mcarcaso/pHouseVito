#!/usr/bin/env npx ts-node --esm
/**
 * Test script for the TracingHarness
 * Run with: npx tsx src/harnesses/test-tracing.ts
 */

import { PiHarness } from "./pi-coding-agent/index.js";
import { withTracing } from "./tracing.js";
import { readFileSync } from "fs";
import { resolve } from "path";

async function main() {
  console.log("=== TracingHarness Test ===\n");

  // Create harness with tracing decorator
  const innerHarness = new PiHarness({
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    },
    thinkingLevel: "off",
  });

  const harness = withTracing(innerHarness, {
    session_id: "test-session-123",
    channel: "test",
    target: "test",
    model: "anthropic/claude-sonnet-4-20250514",
  });

  console.log(`Harness name: ${harness.getName()}`);
  console.log(`Trace file: ${harness.tracePath}\n`);

  const systemPrompt = `You are a helpful assistant. Keep responses brief.`;
  const userMessage = `Say "hello" and nothing else.`;

  console.log("--- Running ---\n");

  let normalizedCount = 0;
  let rawCount = 0;

  try {
    await harness.run(
      systemPrompt,
      userMessage,
      {
        onRawEvent: () => { rawCount++; },
        onNormalizedEvent: (event) => {
          normalizedCount++;
          console.log(`[NORM] ${event.kind}`);
        },
      }
    );
  } catch (err) {
    console.error("\n[ERROR]", err);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Raw events: ${rawCount}`);
  console.log(`Normalized events: ${normalizedCount}`);
  
  // Show trace file contents
  console.log(`\n--- Trace File Contents ---`);
  const traceContent = readFileSync(harness.tracePath, "utf-8");
  const lines = traceContent.trim().split("\n").map(l => JSON.parse(l));

  for (const line of lines) {
    if (line.type === "header") {
      console.log(`[HEADER] harness=${line.harness}, session=${line.session_id}, model=${line.model}`);
    } else if (line.type === "raw_event") {
      const evt = line.event as { type?: string };
      console.log(`[RAW] ${evt.type || "?"}`);
    } else if (line.type === "normalized_event") {
      console.log(`[NORM] ${line.event.kind}`);
    } else if (line.type === "footer") {
      console.log(`[FOOTER] duration=${line.duration_ms}ms, messages=${line.message_count}, tools=${line.tool_calls}${line.error ? `, error=${line.error}` : ""}`);
    }
  }
}

main().catch(console.error);
