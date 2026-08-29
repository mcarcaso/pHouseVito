import { join, resolve } from "node:path";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { ObjectContext } from "../../context/ObjectContext.js";
import { xEmbeddingDb, xFactService, xMemoryService } from "../../lib/x.js";
import { OpenAiEmbeddingService } from "../../services/memory/OpenAiEmbeddingService.js";
import { DefaultMemoryService } from "../../services/memory/DefaultMemoryService.js";
import { DefaultFactService } from "../../services/facts/DefaultFactService.js";
import type { SearchResult } from "../../services/memory/MemoryService.js";
import { extractRelevantExcerpt } from "../../services/memory/search-excerpt.js";
import { FileSecretService } from "../../services/secrets/FileSecretService.js";
import { createEmbeddingDatabase } from "../../stores/embeddings/embedding-database.js";
import { SqliteEmbeddingStore } from "../../stores/embeddings/SqliteEmbeddingStore.js";
import { SqliteFactStore } from "../../stores/facts/SqliteFactStore.js";

const searchOptionsSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(5),
  sessionFilter: z.string().trim().min(1).optional(),
  mode: z.enum(["hybrid", "embedding", "bm25"]).default("hybrid"),
});

type SearchOptions = z.infer<typeof searchOptionsSchema>;

const help = `Usage:
  vito memory search <query> [options]
  vito memory facts <query> [options]
  vito memory recall <query> [--deep] [--current] [--as-of YYYY-MM-DD]

Search options:
  --limit N       Number of results (default: 5)
  --session ID    Filter to one Vito session
  --mode MODE     hybrid, embedding, or bm25 (default: hybrid)

Fact options:
  --limit N       Number of facts (default: 10)
  --current       Return only active or disputed current facts
  --as-of DATE    Return facts valid on YYYY-MM-DD

Recall queries profile, facts, and raw transcripts together. Add --deep for wider retrieval.
`;

function createMemoryCliContext(projectRoot: string): Context {
  const userDir = resolve(projectRoot, "user");
  return new ObjectContext({
    userDir: () => userDir,
    secretsPath: () => join(userDir, "secrets.json"),
    secretService: () => new FileSecretService(),
    embeddingDb: () => createEmbeddingDatabase(join(userDir, "embeddings.db")),
    embeddingStore: () => new SqliteEmbeddingStore(),
    embeddingService: () => new OpenAiEmbeddingService(),
    factStore: () => new SqliteFactStore(),
    factService: () => new DefaultFactService(),
    memoryService: () => new DefaultMemoryService(),
  });
}

function parseSearchOptions(args: string[]): SearchOptions {
  const [query, ...optionArgs] = args;
  const values: Record<string, string | undefined> = { query };
  for (let index = 0; index < optionArgs.length; index += 2) {
    const option = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--limit") values.limit = value;
    else if (option === "--session") values.sessionFilter = value;
    else if (option === "--mode") values.mode = value;
    else throw new Error(`Unknown option: ${option}`);
  }
  return searchOptionsSchema.parse(values);
}

interface FactCliOptions {
  query: string;
  limit: number;
  currentOnly: boolean;
  asOf?: string;
}

function parseFactOptions(args: string[]): FactCliOptions {
  const [query, ...optionArgs] = args;
  if (!query?.trim()) throw new Error("Fact query is required");
  const options: FactCliOptions = { query: query.trim(), limit: 10, currentOnly: false };
  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    if (option === "--current") {
      options.currentOnly = true;
      continue;
    }
    const value = optionArgs[++index];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--limit") options.limit = z.coerce.number().int().min(1).max(100).parse(value);
    else if (option === "--as-of")
      options.asOf = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  return options;
}

function formatScore(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function printResults(results: SearchResult[], options: SearchOptions): void {
  if (results.length === 0) {
    console.log("No results found.");
    return;
  }
  console.log(`Found ${results.length} results:\n`);
  for (const [index, result] of results.entries()) {
    const score =
      options.mode === "hybrid"
        ? `RRF: ${formatScore(result.rrfScore, 6)} | Emb: ${formatScore(result.embeddingScore, 4)} | BM25: ${formatScore(result.bm25Score, 4)}`
        : options.mode === "embedding"
          ? `Similarity: ${formatScore(result.embeddingScore, 4)}`
          : `BM25: ${formatScore(result.bm25Score, 4)}`;
    console.log(`━━━ #${index + 1} — ${score} ━━━`);
    console.log(`Session: ${result.sessionId} | Day: ${result.day} | Messages: ${result.msgCount}`);
    if (result.context) console.log(`Context: ${result.context}`);
    console.log(`\n${extractRelevantExcerpt(result.text, options.query)}\n`);
  }
}

interface RecallCliOptions {
  query: string;
  depth: "quick" | "deep";
  currentOnly: boolean;
  asOf?: string;
}

function parseRecallOptions(args: string[]): RecallCliOptions {
  const [query, ...optionArgs] = args;
  if (!query?.trim()) throw new Error("Recall query is required");
  const options: RecallCliOptions = {
    query: query.trim(),
    depth: "quick",
    currentOnly: false,
  };
  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    if (option === "--deep") options.depth = "deep";
    else if (option === "--current") options.currentOnly = true;
    else if (option === "--as-of") {
      const value = optionArgs[++index];
      if (!value) throw new Error("Missing value for --as-of");
      options.asOf = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(value);
    } else throw new Error(`Unknown option: ${option}`);
  }
  return options;
}

async function runFactSearch(args: string[], x: Context): Promise<number> {
  let options: FactCliOptions;
  try {
    options = parseFactOptions(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid fact search options");
    process.stderr.write(help);
    return 2;
  }
  const results = await xFactService(x).search(x, options.query, {
    limit: options.limit,
    currentOnly: options.currentOnly,
    asOf: options.asOf,
  });
  if (results.length === 0) {
    console.log("No facts found.");
    return 0;
  }
  console.log(`Found ${results.length} facts:\n`);
  for (const [index, result] of results.entries()) {
    const fact = result.fact;
    console.log(
      `━━━ #${index + 1} — Fact ${fact.id} | ${fact.status} | ${fact.authority} | Score ${formatScore(result.score, 4)} ━━━`,
    );
    console.log(fact.canonicalText);
    if (fact.slotKey) console.log(`Slot: ${fact.slotKey}`);
    if (fact.validFrom || fact.validTo) {
      console.log(`Valid: ${fact.validFrom ?? "unknown"} → ${fact.validTo ?? "present"}`);
    }
    for (const source of fact.sources) {
      console.log(
        `Evidence: message ${source.messageId} | ${source.sessionId} | ${new Date(source.sourceTimestamp).toISOString()}`,
      );
      console.log(`> ${source.quote.replaceAll("\n", "\n> ")}`);
    }
    if (result.conflicts.length > 0) {
      console.log(`Conflicts: ${result.conflicts.map((conflict) => conflict.id).join(", ")}`);
    }
    console.log();
  }
  return 0;
}

async function runRecall(args: string[], x: Context): Promise<number> {
  const options = parseRecallOptions(args);
  const result = await xMemoryService(x).recall(x, options.query, {
    depth: options.depth,
    currentOnly: options.currentOnly,
    asOf: options.asOf,
  });
  console.log("═══ CURATED PROFILE ═══");
  if (result.profile.length === 0) console.log("No relevant profile sections.\n");
  for (const section of result.profile) {
    console.log(`## ${section.heading} [score ${section.score}]\n${section.text}\n`);
  }
  console.log("═══ ATOMIC FACTS ═══");
  if (result.facts.length === 0) console.log("No facts found.\n");
  for (const item of result.facts) {
    console.log(
      `[Fact ${item.fact.id} | ${item.fact.status} | ${item.fact.authority}] ${item.fact.canonicalText}`,
    );
    for (const source of item.fact.sources) {
      console.log(`  message ${source.messageId}: ${JSON.stringify(source.quote)}`);
    }
  }
  console.log("\n═══ RAW TRANSCRIPT EVIDENCE ═══");
  if (result.transcripts.length === 0) console.log("No transcript results.");
  for (const transcript of result.transcripts) {
    console.log(
      `\n[${transcript.sessionId} | ${transcript.day} | RRF ${formatScore(transcript.rrfScore, 6)}]`,
    );
    if (transcript.context) console.log(`Context: ${transcript.context}`);
    console.log(extractRelevantExcerpt(transcript.text, options.query));
  }
  return 0;
}

export async function runMemoryCommand(args: string[], projectRoot: string): Promise<number> {
  const [command, ...commandArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return 0;
  }
  if (command !== "search" && command !== "facts" && command !== "recall") {
    console.error(`Unknown memory command: ${command}`);
    process.stderr.write(help);
    return 2;
  }
  if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }

  const x = createMemoryCliContext(projectRoot);
  try {
    if (command === "facts") return await runFactSearch(commandArgs, x);
    if (command === "recall") return await runRecall(commandArgs, x);

    let options: SearchOptions;
    try {
      options = parseSearchOptions(commandArgs);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Invalid memory search options");
      process.stderr.write(help);
      return 2;
    }
    const results = await xMemoryService(x).search(x, options.query, {
      limit: options.limit,
      sessionFilter: options.sessionFilter,
      mode: options.mode,
    });
    printResults(results, options);
    return 0;
  } catch (error) {
    console.error(
      `Memory operation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    xEmbeddingDb(x).close();
  }
}
