/**
 * HARNESS BATTLE v4
 * 
 * Uses the REAL orchestrator system prompt (minus session context).
 * Each harness gets its OWN sandbox:
 * - Pi generates: /tmp/pi-mobster.png, /tmp/pi-mobster-hat.png, deploys battle-test-pi
 * - CC generates: /tmp/cc-mobster.png, /tmp/cc-mobster-hat.png, deploys battle-test-cc
 * 
 * Run: npx tsx src/harnesses/harness-battle.ts
 * Delete when done: rm src/harnesses/harness-battle.ts
 */

import { PiHarness } from "./pi-coding-agent/index.js";
import { ClaudeCodeHarness } from "./claude-code/index.js";
import type { Harness, NormalizedEvent } from "./types.js";
import { withTracing } from "./tracing.js";
import { buildTestSystemPrompt } from "../orchestrator.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Test Cases Factory ──
// Returns test cases with harness-specific paths

interface TestCase {
  name: string;
  prompt: string;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  validate: (events: NormalizedEvent[]) => Promise<{ pass: boolean; reason: string }> | { pass: boolean; reason: string };
}

function createTestCases(prefix: string): TestCase[] {
  return [
    // ═══════════════════════════════════════════════════════════════════════════
    // BASIC TESTS
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: "Simple Q&A",
      prompt: "What is 2 + 2? Answer with just the number.",
      validate: (events) => {
        const text = extractText(events);
        const pass = text.includes("4");
        return { pass, reason: pass ? "Contains '4'" : "Missing '4'" };
      },
    },
    {
      name: "File Read",
      prompt: "Read the file package.json and tell me what the 'name' field is. Just the name value.",
      validate: (events) => {
        const text = extractText(events);
        const pass = text.toLowerCase().includes("vito");
        return { pass, reason: pass ? "Found 'vito'" : "Missing 'vito'" };
      },
    },

    {
      name: "Multi-step Chain",
      prompt: "List the files in the src/harnesses directory, count how many .ts files there are, and tell me the count.",
      validate: (events) => {
        const text = extractText(events);
        const hasNumber = /\b([89]|1[0-9]|20)\b/.test(text);
        return { pass: hasNumber, reason: hasNumber ? "Has a reasonable count" : "No count found in expected range" };
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SKILL TESTS - Each harness gets its own files/apps
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: "🎨 Image Generation",
      prompt: `Use the gemini-image skill to generate an image of a cartoon Italian mobster eating pasta. Save it to /tmp/${prefix}-mobster.png`,
      validate: async (events) => {
        const { existsSync } = await import("fs");
        const exists = existsSync(`/tmp/${prefix}-mobster.png`);
        return { pass: exists, reason: exists ? "Image file created" : "Image file not found" };
      },
      // Note: don't teardown mobster.png - image edit test needs it
    },
    {
      name: "🖼️ Image Edit",
      prompt: `Use the gemini-image skill to edit the image at /tmp/${prefix}-mobster.png - add a fancy hat to the mobster. Save the result to /tmp/${prefix}-mobster-hat.png`,
      validate: async (events) => {
        const { existsSync } = await import("fs");
        const exists = existsSync(`/tmp/${prefix}-mobster-hat.png`);
        return { pass: exists, reason: exists ? "Edited image created" : "Edited image not found" };
      },
      teardown: async () => {
        // Clean up both image files after edit test runs
        const { unlinkSync, existsSync } = await import("fs");
        const files = [`/tmp/${prefix}-mobster.png`, `/tmp/${prefix}-mobster-hat.png`];
        for (const file of files) {
          if (existsSync(file)) unlinkSync(file);
        }
      },
    },
    {
      name: "🌐 Web App Creation",
      prompt: `Create a simple web app called "battle-test-${prefix}" using the create_app tool. It should be a static HTML page that says "Battle Test - ${prefix.toUpperCase()} Harness!" in big letters and shows the current timestamp. Make it look nice with some CSS styling. The app will be live at battle-test-${prefix}.theworstproductions.com`,
      validate: async (events) => {
        // Give it a moment to deploy
        await new Promise(r => setTimeout(r, 3000));
        try {
          const response = await fetch(`https://battle-test-${prefix}.theworstproductions.com`, { 
            signal: AbortSignal.timeout(10000) 
          });
          const body = await response.text();
          const pass = response.ok && (body.toLowerCase().includes("battle test") || body.toLowerCase().includes(prefix));
          return { pass, reason: pass ? "App is live and responding!" : `App returned: ${response.status}` };
        } catch (err: any) {
          return { pass: false, reason: `Could not reach app: ${err.message}` };
        }
      },
      teardown: async () => {
        // Delete the test app after validation
        const { execSync } = await import("child_process");
        try {
          // Use the delete_app logic - stop PM2, remove from tunnel, delete files
          execSync(`pm2 delete battle-test-${prefix} 2>/dev/null || true`, { encoding: 'utf-8' });
          execSync(`rm -rf /Users/mike/vito3.0/user/apps/battle-test-${prefix}`, { encoding: 'utf-8' });
        } catch (e) {
          // App might not exist, that's fine
        }
      },
    },
    {
      name: "📈 Stock Tickers",
      prompt: "How are my tickers doing? Give me the current prices and how they're doing today (up or down).",
      validate: (events) => {
        const text = extractText(events).toLowerCase();
        // Should figure out from memories that Mike's tickers are QQQ, GOOGL, BTC
        const hasQQQ = text.includes("qqq");
        const hasGOOGL = text.includes("googl") || text.includes("google");
        const hasBTC = text.includes("btc") || text.includes("bitcoin");
        const hasPrice = /\$[\d,]+/.test(text) || /\d+[\d,]*\.\d{2}/.test(text);
        const pass = hasQQQ && hasGOOGL && hasBTC && hasPrice;
        return { 
          pass, 
          reason: pass ? "Found tickers from memory + prices" : 
            `Missing: ${!hasQQQ ? "QQQ " : ""}${!hasGOOGL ? "GOOGL " : ""}${!hasBTC ? "BTC " : ""}${!hasPrice ? "prices" : ""}` 
        };
      },
    },
    {
      name: "🔍 Web Search",
      prompt: "Search the web for 'F1 2026 season schedule' and tell me when the first race is.",
      validate: (events) => {
        const text = extractText(events).toLowerCase();
        const hasDate = /march|april|february|2026/.test(text);
        const hasLocation = /australia|bahrain|melbourne|sakhir/.test(text);
        const pass = hasDate || hasLocation;
        return { pass, reason: pass ? "Found race info" : "No clear race date/location found" };
      },
    },
    {
      name: "📅 Calendar Scheduling",
      prompt: `Create a Google Calendar event with Mike on Feb 20 at 11am called "Battle Test ${prefix.toUpperCase()}". There's no skill for this — figure it out. Invite me.`,
      validate: async (events) => {
        // Check that it created a calendar event AND invited Mike
        const toolCalls = extractToolCalls(events);
        const text = extractText(events).toLowerCase();
        const usedBash = toolCalls.some(t => t.includes("Bash") || t.includes("bash"));
        const mentionsScheduled = text.includes("scheduled") || text.includes("created") || text.includes("added") || text.includes("calendar");
        const invitedMike = text.includes("invited") || text.includes("attendee") || text.includes("mikecarcasole");
        const pass = usedBash && mentionsScheduled && invitedMike;
        return { 
          pass, 
          reason: pass ? "Created event and invited Mike" : 
            `${!usedBash ? "No bash call " : ""}${!mentionsScheduled ? "No confirmation " : ""}${!invitedMike ? "Didn't invite Mike" : ""}` 
        };
      },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // HARD MODE - Tests that'll make 'em sweat
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name: "🧠 Multi-Tool Reasoning",
      prompt: `I need you to figure out which of my deployed apps is using the most disk space, then tell me the 3 largest files in that app. Don't just list apps - I need actual file sizes.`,
      validate: async (events) => {
        const text = extractText(events).toLowerCase();
        const toolCalls = extractToolCalls(events);
        // Should use multiple bash calls to find apps, check sizes, then drill down
        const bashCalls = toolCalls.filter(t => t.toLowerCase().includes("bash")).length;
        const hasAppName = text.includes("battle") || text.includes("dashboard") || text.includes("app");
        const hasSizes = /\d+[kmg]?\s*(bytes?|kb|mb|gb)/i.test(text) || /\d+\.\d+\s*[kmg]/i.test(text);
        const pass = bashCalls >= 2 && hasAppName && hasSizes;
        return {
          pass,
          reason: pass ? `Used ${bashCalls} bash calls, found sizes` :
            `${bashCalls < 2 ? "Not enough investigation " : ""}${!hasAppName ? "No app identified " : ""}${!hasSizes ? "No file sizes" : ""}`
        };
      },
    },
    {
      name: "🔧 Debug & Fix",
      prompt: `There's a syntax error in /tmp/battle-broken-${prefix}.js. Find it and fix it, then verify the file runs without errors.`,
      setup: async () => {
        // Create a file with a subtle syntax error
        const { writeFileSync } = await import("fs");
        const brokenCode = `
// Calculate fibonacci
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2)
}

// Missing closing brace intentionally
function sumArray(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  // missing closing brace here
  return total;
}

console.log(fibonacci(10));
console.log(sumArray([1, 2, 3, 4, 5]));
`;
        writeFileSync(`/tmp/battle-broken-${prefix}.js`, brokenCode);
      },
      validate: async (events) => {
        const toolCalls = extractToolCalls(events);
        const { existsSync, readFileSync } = await import("fs");
        const { execSync } = await import("child_process");
        
        // Check if the file was edited
        const wasEdited = toolCalls.some(t => t.toLowerCase().includes("edit") || t.toLowerCase().includes("write"));
        
        // Try to run the file
        let runs = false;
        if (existsSync(`/tmp/battle-broken-${prefix}.js`)) {
          try {
            execSync(`node /tmp/battle-broken-${prefix}.js`, { timeout: 5000 });
            runs = true;
          } catch (e) {
            runs = false;
          }
        }
        
        return {
          pass: wasEdited && runs,
          reason: wasEdited && runs ? "Fixed the bug and verified it runs" :
            `${!wasEdited ? "Didn't edit the file " : ""}${!runs ? "File still has errors" : ""}`
        };
      },
      teardown: async () => {
        const { unlinkSync, existsSync } = await import("fs");
        const file = `/tmp/battle-broken-${prefix}.js`;
        if (existsSync(file)) unlinkSync(file);
      },
    },
    {
      name: "🕵️ Memory Recall",
      prompt: `What's my wife's name, and what are my kids' names? Also, what's my shoulder situation and how does it affect my workouts?`,
      validate: (events) => {
        const text = extractText(events).toLowerCase();
        // These should come from Mike's memory files
        const hasWifeName = text.includes("mary") || text.includes("mary-ann");
        const hasKids = (text.includes("ian") || text.includes("elia"));
        const hasShoulder = text.includes("shoulder") && (text.includes("injury") || text.includes("constraint") || text.includes("careful") || text.includes("rehab"));
        const pass = hasWifeName && hasKids && hasShoulder;
        return {
          pass,
          reason: pass ? "Recalled family + fitness context" :
            `${!hasWifeName ? "Missing wife " : ""}${!hasKids ? "Missing kids " : ""}${!hasShoulder ? "Missing shoulder context" : ""}`
        };
      },
    },
    {
      name: "🔄 Self-Correction",
      prompt: `Write a bash one-liner that finds all .ts files in the src directory modified in the last 24 hours, counts the total lines of code across all of them, and outputs just the number. Execute it and give me the result.`,
      validate: (events) => {
        const text = extractText(events).toLowerCase();
        const toolCalls = extractToolCalls(events);
        const usedBash = toolCalls.some(t => t.toLowerCase().includes("bash"));
        // Should have a number in the response
        const hasNumber = /\b\d+\b/.test(extractText(events));
        // Should mention the result, not just the command
        const mentionsLines = text.includes("line") || text.includes("total") || text.includes("result");
        const pass = usedBash && hasNumber && mentionsLines;
        return {
          pass,
          reason: pass ? "Executed command and reported result" :
            `${!usedBash ? "No bash execution " : ""}${!hasNumber ? "No numeric result " : ""}${!mentionsLines ? "No clear answer" : ""}`
        };
      },
    },
    {
      name: "🎯 Ambiguous Request",
      prompt: `Make it better.`,
      setup: async () => {
        // Create a mediocre function they need to improve
        const { writeFileSync } = await import("fs");
        const code = `// /tmp/battle-improve-${prefix}.js
function processData(data) {
  var result = [];
  for (var i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      result.push(data[i] * 2);
    }
  }
  return result;
}
module.exports = processData;
`;
        writeFileSync(`/tmp/battle-improve-${prefix}.js`, code);
      },
      validate: async (events) => {
        const text = extractText(events).toLowerCase();
        const toolCalls = extractToolCalls(events);
        
        // They should ask for clarification OR read files to understand context
        const askedClarification = text.includes("what") || text.includes("which") || text.includes("clarif") || text.includes("could you");
        const investigatedFirst = toolCalls.some(t => t.toLowerCase().includes("read") || t.toLowerCase().includes("bash"));
        
        // If they just went ahead and did something without understanding, that's bad
        const justWrote = toolCalls.some(t => t.toLowerCase().includes("write") || t.toLowerCase().includes("edit")) && !investigatedFirst;
        
        const pass = askedClarification || investigatedFirst;
        return {
          pass,
          reason: pass ? "Sought clarification or investigated first" :
            justWrote ? "Made changes without understanding context" : "Unclear response to ambiguous request"
        };
      },
      teardown: async () => {
        const { unlinkSync, existsSync } = await import("fs");
        const file = `/tmp/battle-improve-${prefix}.js`;
        if (existsSync(file)) unlinkSync(file);
      },
    },
    {
      name: "🧩 Complex Reasoning",
      prompt: `I need to send an email to my wife about the kids' school calendar for next week. First figure out what school events are coming up by checking the SBS calendar skill, then compose a nice email. Don't send it - just show me what you'd send.`,
      validate: async (events) => {
        const text = extractText(events).toLowerCase();
        const toolCalls = extractToolCalls(events);
        
        // Must figure out wife's email from memories
        const foundWifeEmail = text.includes("mary") || text.includes("maryann") || toolCalls.some(t => t.includes("FAMILY"));
        // Must use calendar skill or at least try
        const checkedCalendar = toolCalls.some(t => 
          t.toLowerCase().includes("sbs") || 
          t.toLowerCase().includes("calendar") ||
          t.toLowerCase().includes("skill")
        );
        // Must compose an email
        const hasEmail = text.includes("subject") || text.includes("dear") || text.includes("hi mary") || text.includes("hey mary");
        
        const pass = foundWifeEmail && checkedCalendar && hasEmail;
        return {
          pass,
          reason: pass ? "Found wife info, checked calendar, composed email" :
            `${!foundWifeEmail ? "Didn't find wife info " : ""}${!checkedCalendar ? "Didn't check calendar " : ""}${!hasEmail ? "No email composed" : ""}`
        };
      },
    },
    {
      name: "⚡ Speed Run",
      prompt: `Quick: what's 17 * 23? Just the number, nothing else.`,
      validate: (events) => {
        const text = extractText(events).trim();
        // Should be JUST "391" or very close to it
        const isClean = text === "391" || text === "391." || text.startsWith("391\n");
        const hasAnswer = text.includes("391");
        return {
          pass: isClean,
          reason: isClean ? "Clean answer" : hasAnswer ? "Correct but not clean" : "Wrong or verbose answer"
        };
      },
    },
    {
      name: "🪆 Recursive Problem",
      prompt: `Create a file /tmp/battle-recursive-${prefix}.js that exports a function to calculate factorial recursively. Then use that file to calculate 10! and tell me the answer.`,
      validate: async (events) => {
        const text = extractText(events).toLowerCase();
        const { existsSync, readFileSync } = await import("fs");
        
        // Check file was created with recursive implementation
        let hasRecursion = false;
        if (existsSync(`/tmp/battle-recursive-${prefix}.js`)) {
          const content = readFileSync(`/tmp/battle-recursive-${prefix}.js`, 'utf-8');
          hasRecursion = content.includes('factorial') && content.includes('return') && 
            (content.includes('factorial(n - 1)') || content.includes('factorial(n-1)'));
        }
        
        // Check correct answer (10! = 3628800)
        const hasAnswer = text.includes("3628800") || text.includes("3,628,800");
        
        const pass = hasRecursion && hasAnswer;
        return {
          pass,
          reason: pass ? "Created recursive function, got correct answer" :
            `${!hasRecursion ? "No recursive implementation " : ""}${!hasAnswer ? "Wrong answer (10! = 3628800)" : ""}`
        };
      },
      teardown: async () => {
        const { unlinkSync, existsSync } = await import("fs");
        const file = `/tmp/battle-recursive-${prefix}.js`;
        if (existsSync(file)) unlinkSync(file);
      },
    },
  ];
}

// ── Helpers ──

function extractText(events: NormalizedEvent[]): string {
  return events
    .filter((e) => e.kind === "assistant")
    .map((e) => e.content)
    .join("");
}

function extractToolCalls(events: NormalizedEvent[]): string[] {
  return events
    .filter((e) => e.kind === "tool_start")
    .map((e) => `${e.tool}(${JSON.stringify(e.args).slice(0, 80)}...)`);
}

interface TestResult {
  name: string;
  pass: boolean;
  reason: string;
  durationMs: number;
  eventCount: number;
  response: string;
  toolCalls: string[];
}

// Test timeout in milliseconds (5 minutes should be plenty for any test)
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

async function runTest(harness: Harness, test: TestCase, systemPrompt: string): Promise<TestResult> {
  const events: NormalizedEvent[] = [];
  const start = Date.now();

  // Create abort controller for timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`  ⏰ Test timed out after ${TEST_TIMEOUT_MS / 1000}s — aborting`);
    abortController.abort();
  }, TEST_TIMEOUT_MS);

  try {
    // Run setup if provided
    if (test.setup) {
      await test.setup();
    }
    
    await harness.run(
      systemPrompt,
      test.prompt,
      {
        onInvocation: () => {},
        onRawEvent: () => {},
        onNormalizedEvent: (event) => {
          events.push(event);
        },
      },
      abortController.signal
    );
    
    clearTimeout(timeoutId);

    const duration = Date.now() - start;
    const validation = await test.validate(events);

    // Run teardown if provided (cleanup even on success)
    if (test.teardown) {
      try {
        await test.teardown();
      } catch (e) {
        // Don't let teardown errors fail the test
        console.error(`  ⚠️ Teardown error: ${e}`);
      }
    }

    return {
      name: test.name,
      pass: validation.pass,
      reason: validation.reason,
      durationMs: duration,
      eventCount: events.length,
      response: extractText(events),
      toolCalls: extractToolCalls(events),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    
    // Run teardown even on error
    if (test.teardown) {
      try {
        await test.teardown();
      } catch (e) {
        console.error(`  ⚠️ Teardown error: ${e}`);
      }
    }

    // Check if this was a timeout
    const isTimeout = abortController.signal.aborted;
    const reason = isTimeout 
      ? `Timeout: Test exceeded ${TEST_TIMEOUT_MS / 1000}s limit`
      : `Error: ${err.message}`;

    return {
      name: test.name,
      pass: false,
      reason,
      durationMs: Date.now() - start,
      eventCount: events.length,
      response: extractText(events) || `[${reason}]`,
      toolCalls: extractToolCalls(events),
    };
  }
}

async function runBattle(harnessName: string, harness: Harness, prefix: string, systemPrompt: string, testFilter: string | null): Promise<TestResult[]> {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`🥊 ${harnessName} (prefix: ${prefix})`);
  console.log("═".repeat(70));

  let testCases = createTestCases(prefix);
  
  // Filter tests if specified
  if (testFilter) {
    testCases = testCases.filter(t => t.name.toLowerCase().includes(testFilter));
    if (testCases.length === 0) {
      console.log(`\n  ❌ No tests match filter "${testFilter}"`);
      return [];
    }
    console.log(`  🔍 Running ${testCases.length} test(s) matching "${testFilter}"`);
  }

  const results: TestResult[] = [];

  for (const test of testCases) {
    console.log(`\n  ┌─ ${test.name}`);
    console.log(`  │ Prompt: "${test.prompt.slice(0, 70)}..."`);
    process.stdout.write(`  │ Running... `);
    
    const result = await runTest(harness, test, systemPrompt);
    results.push(result);

    const icon = result.pass ? "✅" : "❌";
    console.log(`${icon} ${(result.durationMs/1000).toFixed(1)}s`);
    console.log(`  │ Reason: ${result.reason}`);
    console.log(`  │ Tools: ${result.toolCalls.length > 0 ? result.toolCalls.slice(0, 3).join(", ") : "(none)"}`);
    console.log(`  │ Response: "${result.response.slice(0, 120).replace(/\n/g, " ")}..."`);
    // Output trace file in parseable format (harness has tracePath after run)
    const tracePath = (harness as any).tracePath;
    if (tracePath) {
      console.log(`  │ TRACE_FILE: ${tracePath}`);
    }
    console.log(`  └─`);
  }

  return results;
}

function printSummary(piResults: TestResult[], ccResults: TestResult[]) {
  console.log(`\n${"═".repeat(70)}`);
  console.log("📊 FINAL SCORECARD");
  console.log("═".repeat(70));

  const piPassed = piResults.filter((r) => r.pass).length;
  const ccPassed = ccResults.filter((r) => r.pass).length;
  const piTotalTime = piResults.reduce((sum, r) => sum + r.durationMs, 0);
  const ccTotalTime = ccResults.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`\n┌────────────────────┬───────────────────┬───────────────────┐`);
  console.log(`│ Metric             │ Pi Coding Agent   │ Claude Code       │`);
  console.log(`├────────────────────┼───────────────────┼───────────────────┤`);
  console.log(`│ Tests Passed       │ ${String(piPassed + "/" + piResults.length).padEnd(17)} │ ${String(ccPassed + "/" + ccResults.length).padEnd(17)} │`);
  console.log(`│ Total Time         │ ${String((piTotalTime/1000).toFixed(1) + "s").padEnd(17)} │ ${String((ccTotalTime/1000).toFixed(1) + "s").padEnd(17)} │`);
  console.log(`│ Avg Time/Test      │ ${String((piTotalTime / piResults.length / 1000).toFixed(1) + "s").padEnd(17)} │ ${String((ccTotalTime / ccResults.length / 1000).toFixed(1) + "s").padEnd(17)} │`);
  console.log(`└────────────────────┴───────────────────┴───────────────────┘`);

  console.log(`\n📋 Test-by-Test:`);
  console.log(`${"─".repeat(70)}`);
  
  for (let i = 0; i < piResults.length; i++) {
    const pi = piResults[i];
    const cc = ccResults[i];
    const piIcon = pi.pass ? "✅" : "❌";
    const ccIcon = cc.pass ? "✅" : "❌";
    const faster = pi.durationMs < cc.durationMs ? "⚡Pi" : "⚡CC";
    const timeDiff = Math.abs(pi.durationMs - cc.durationMs);
    
    console.log(`  ${pi.name}`);
    console.log(`    Pi: ${piIcon} ${(pi.durationMs/1000).toFixed(1)}s | CC: ${ccIcon} ${(cc.durationMs/1000).toFixed(1)}s | ${faster} +${(timeDiff/1000).toFixed(1)}s`);
  }

  console.log(`\n${"═".repeat(70)}`);
  if (piPassed > ccPassed) {
    console.log("🏆 WINNER: Pi Coding Agent (more tests passed)");
  } else if (ccPassed > piPassed) {
    console.log("🏆 WINNER: Claude Code (more tests passed)");
  } else if (piTotalTime < ccTotalTime) {
    console.log("🏆 WINNER: Pi Coding Agent (tie-breaker: faster)");
  } else if (ccTotalTime < piTotalTime) {
    console.log("🏆 WINNER: Claude Code (tie-breaker: faster)");
  } else {
    console.log("🤝 TIE!");
  }
  console.log("═".repeat(70));
}

// ── Main ──

function printUsage() {
  console.log(`
Usage: npx tsx src/harnesses/harness-battle.ts <harness> [test-filter]

  <harness>      Required: "pi", "cc", "both", or "pi:<provider>/<model>"
  [test-filter]  Optional: partial test name to match (case-insensitive)

Examples:
  npx tsx src/harnesses/harness-battle.ts pi              # Run all tests on Pi (Claude Sonnet)
  npx tsx src/harnesses/harness-battle.ts cc "stock"      # Run stock test on CC
  npx tsx src/harnesses/harness-battle.ts both "image"    # Run image tests on both
  npx tsx src/harnesses/harness-battle.ts pi "simple"     # Run Simple Q&A on Pi

  # Model override for Pi harness:
  npx tsx src/harnesses/harness-battle.ts pi:openrouter/google/gemini-2.5-flash "simple"
  npx tsx src/harnesses/harness-battle.ts pi:google/gemini-2.5-pro "file"

Available tests:
  - Simple Q&A
  - File Read
  - Multi-step Chain
  - Image Generation
  - Image Edit
  - Web App Creation
  - Stock Tickers
  - Web Search
  - Calendar Scheduling
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const harnessArg = args[0].toLowerCase();
  const testFilter = args[1]?.toLowerCase() || null;

  // Allow model override for pi: pi:openrouter/google/gemini-2.5-flash
  // Or named variant: kimi:openrouter/moonshotai/kimi-k2.5 (saves results under "kimi")
  let piModelOverride: { provider: string; name: string } | null = null;
  let resultKey = harnessArg; // The key used in results JSON
  
  if (harnessArg.includes(":")) {
    const [keyPart, ...rest] = harnessArg.split(":");
    const modelSpec = rest.join(":"); // e.g., "openrouter/google/gemini-2.5-flash"
    const slashIdx = modelSpec.indexOf("/");
    if (slashIdx > 0) {
      piModelOverride = {
        provider: modelSpec.slice(0, slashIdx),
        name: modelSpec.slice(slashIdx + 1),
      };
      resultKey = keyPart; // Use the prefix as the result key (e.g., "kimi" or "pi")
    }
  }

  // For base harness validation, any key with a model override is treated as "pi"
  const baseHarness = piModelOverride ? "pi" : harnessArg;
  if (!["pi", "cc", "both"].includes(baseHarness)) {
    console.error(`❌ Invalid harness: "${baseHarness}". Must be "pi", "cc", or "both".`);
    printUsage();
    process.exit(1);
  }

  const runPi = baseHarness === "pi" || baseHarness === "both";
  const runCC = baseHarness === "cc" || baseHarness === "both";

  console.log("🥊 HARNESS BATTLE v4 🥊");
  console.log("Using REAL orchestrator system prompt (minus session context)!\n");
  console.log(`🎯 Harness: ${baseHarness.toUpperCase()}`);
  if (piModelOverride) {
    console.log(`🔧 Pi Model Override: ${piModelOverride.provider}/${piModelOverride.name}`);
  }
  if (testFilter) {
    console.log(`🔍 Test filter: "${testFilter}"`);
  }

  // Load config and soul to build the real system prompt
  const configPath = resolve(process.cwd(), "user/vito.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  
  const soulPath = resolve(process.cwd(), config.soulPath || "user/SOUL.md");
  const soul = readFileSync(soulPath, "utf-8");
  const skillsDir = resolve(process.cwd(), config.skillsDir || "user/skills");
  
  // Build the test system prompt (no session context, just personality + skills + system instructions)
  const systemPrompt = buildTestSystemPrompt(
    soul,
    skillsDir,
    "## Channel: Battle Test\nYou are being tested. Be concise and get the job done."
  );
  
  console.log(`📋 System prompt loaded (${systemPrompt.length} chars)`);
  console.log(`   Includes: personality, system instructions, skills list`);
  console.log(`   Excludes: session context, cross-session memory\n`);

  // Initialize harnesses (raw)
  const piModelConfig = piModelOverride || {
    provider: "anthropic",
    name: "claude-sonnet-4-20250514",
  };
  const piRaw = new PiHarness({
    model: piModelConfig,
  });

  const ccRaw = new ClaudeCodeHarness({
    model: "claude-sonnet-4-20250514",
  });

  // Get custom instructions before wrapping
  const piCustom = piRaw.getCustomInstructions?.() || "";
  const ccCustom = ccRaw.getCustomInstructions?.() || "";
  
  const piSystemPrompt = piCustom ? `${systemPrompt}\n\n${piCustom}` : systemPrompt;
  const ccSystemPrompt = ccCustom ? `${systemPrompt}\n\n${ccCustom}` : systemPrompt;
  
  console.log(`📝 Pi custom instructions: ${piCustom.length} chars`);
  console.log(`📝 CC custom instructions: ${ccCustom.length} chars`);

  // Wrap with tracing
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const piModelLabel = `${piModelConfig.provider}/${piModelConfig.name}`;
  const piHarness = withTracing(piRaw, {
    session_id: `battle-${timestamp}`,
    channel: "battle",
    target: "pi",
    model: piModelLabel,
  });
  const ccHarness = withTracing(ccRaw, {
    session_id: `battle-${timestamp}`,
    channel: "battle",
    target: "cc",
    model: "claude-sonnet-4-20250514",
  });
  
  console.log(`📊 Tracing enabled:`);
  if (runPi) console.log(`   Pi: ${piHarness.tracePath}`);
  if (runCC) console.log(`   CC: ${ccHarness.tracePath}`);
  console.log();
  
  let piResults: TestResult[] = [];
  let ccResults: TestResult[] = [];
  
  if (runPi) {
    // Use resultKey as prefix so each harness variant gets isolated temp files
    piResults = await runBattle("Pi Coding Agent", piHarness, resultKey, piSystemPrompt, testFilter);
  }
  
  if (runCC) {
    ccResults = await runBattle("Claude Code", ccHarness, "cc", ccSystemPrompt, testFilter);
  }

  // Print summary (only if both ran)
  if (runPi && runCC && piResults.length > 0 && ccResults.length > 0) {
    printSummary(piResults, ccResults);
  } else {
    // Single harness summary
    const results = runPi ? piResults : ccResults;
    const name = runPi ? "Pi" : "CC";
    const passed = results.filter(r => r.pass).length;
    const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);
    
    console.log(`\n${"═".repeat(70)}`);
    console.log(`📊 ${name} RESULTS: ${passed}/${results.length} passed in ${(totalTime/1000).toFixed(1)}s`);
    console.log("═".repeat(70));
  }

  // Copy images to their respective apps for hosting (only if image tests ran)
  const { copyFileSync, existsSync, mkdirSync } = await import("fs");
  const ranImageTests = !testFilter || testFilter.includes("image");
  
  if (ranImageTests) {
    console.log("\n📸 Copying images to web apps for hosting...");
    try {
      if (runPi && existsSync("/tmp/pi-mobster.png")) {
        const piAppDir = "user/apps/battle-test-pi";
        if (existsSync(piAppDir)) {
          copyFileSync("/tmp/pi-mobster.png", `${piAppDir}/mobster.png`);
          if (existsSync("/tmp/pi-mobster-hat.png")) {
            copyFileSync("/tmp/pi-mobster-hat.png", `${piAppDir}/mobster-hat.png`);
          }
          console.log("  ✓ Pi images copied to battle-test-pi app");
        }
      }
      if (runCC && existsSync("/tmp/cc-mobster.png")) {
        const ccAppDir = "user/apps/battle-test-cc";
        if (existsSync(ccAppDir)) {
          copyFileSync("/tmp/cc-mobster.png", `${ccAppDir}/mobster.png`);
          if (existsSync("/tmp/cc-mobster-hat.png")) {
            copyFileSync("/tmp/cc-mobster-hat.png", `${ccAppDir}/mobster-hat.png`);
          }
          console.log("  ✓ CC images copied to battle-test-cc app");
        }
      }
    } catch (err: any) {
      console.log(`  ⚠ Image copy failed: ${err.message}`);
    }
  }

  // Save results to JSON
  const { writeFileSync } = await import("fs");
  const resultsToSave = runPi && runCC 
    ? { [resultKey]: piResults, cc: ccResults }
    : runPi ? { [resultKey]: piResults } : { cc: ccResults };
  writeFileSync("/tmp/battle-results-v4.json", JSON.stringify(resultsToSave, null, 2));
  console.log("\n📄 Full results saved to /tmp/battle-results-v4.json");

  console.log("\n✅ Battle complete.");
}

main().catch(console.error);
