import { join, resolve } from "node:path";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { ObjectContext } from "../../context/ObjectContext.js";
import { xEmbeddingDb, xMemoryService } from "../../lib/x.js";
import { OpenAiEmbeddingService } from "../../services/memory/OpenAiEmbeddingService.js";
import { DefaultMemoryService } from "../../services/memory/DefaultMemoryService.js";
import type { SearchResult } from "../../services/memory/MemoryService.js";
import { FileSecretService } from "../../services/secrets/FileSecretService.js";
import { createEmbeddingDatabase } from "../../stores/embeddings/embedding-database.js";
import { SqliteEmbeddingStore } from "../../stores/embeddings/SqliteEmbeddingStore.js";

const searchOptionsSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(5),
  sessionFilter: z.string().trim().min(1).optional(),
  mode: z.enum(["hybrid", "embedding", "bm25"]).default("hybrid"),
});

type SearchOptions = z.infer<typeof searchOptionsSchema>;

const help = `Usage: vito memory search <query> [options]

Options:
  --limit N       Number of results (default: 5)
  --session ID    Filter to one Vito session
  --mode MODE     hybrid, embedding, or bm25 (default: hybrid)
`;

function createMemoryCliContext(projectRoot: string): Context {
  const userDir = resolve(projectRoot, "user");
  return new ObjectContext({
    secretsPath: () => join(userDir, "secrets.json"),
    secretService: () => new FileSecretService(),
    embeddingDb: () => createEmbeddingDatabase(join(userDir, "embeddings.db")),
    embeddingStore: () => new SqliteEmbeddingStore(),
    embeddingService: () => new OpenAiEmbeddingService(),
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

function printResults(results: SearchResult[], options: SearchOptions): void {
  if (results.length === 0) {
    console.log("No results found.");
    return;
  }
  console.log(`Found ${results.length} results:\n`);
  for (const [index, result] of results.entries()) {
    const score = options.mode === "hybrid"
      ? `RRF: ${result.rrfScore.toFixed(6)} | Emb: ${result.embeddingScore.toFixed(4)} | BM25: ${result.bm25Score.toFixed(4)}`
      : options.mode === "embedding"
        ? `Similarity: ${result.embeddingScore.toFixed(4)}`
        : `BM25: ${result.bm25Score.toFixed(4)}`;
    console.log(`━━━ #${index + 1} — ${score} ━━━`);
    console.log(`Session: ${result.sessionId} | Day: ${result.day} | Messages: ${result.msgCount}`);
    if (result.context) console.log(`Context: ${result.context}`);
    console.log(`\n${result.text.slice(0, 500)}${result.text.length > 500 ? "\n... (truncated)" : ""}\n`);
  }
}

export async function runMemoryCommand(
  args: string[],
  projectRoot: string,
): Promise<number> {
  const [command, ...commandArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return 0;
  }
  if (command !== "search") {
    console.error(`Unknown memory command: ${command}`);
    process.stderr.write(help);
    return 2;
  }
  if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }

  let options: SearchOptions;
  try {
    options = parseSearchOptions(commandArgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid memory search options");
    process.stderr.write(help);
    return 2;
  }

  const x = createMemoryCliContext(projectRoot);
  try {
    const results = await xMemoryService(x).search(x, options.query, {
      limit: options.limit,
      sessionFilter: options.sessionFilter,
      mode: options.mode,
    });
    printResults(results, options);
    return 0;
  } catch (error) {
    console.error(`Memory search failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    xEmbeddingDb(x).close();
  }
}
