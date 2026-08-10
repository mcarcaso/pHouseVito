/** Compatibility adapter used by standalone memory-search skills. */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Context } from "../context/Context.js";
import { ObjectContext } from "../context/ObjectContext.js";
import { xEmbeddingDb } from "../lib/x.js";
import { OpenAiEmbeddingService } from "../services/memory/OpenAiEmbeddingService.js";
import {
  getLastEmbeddedMessageId as getLastEmbeddedMessageIdInContext,
  searchMemory as searchMemoryInContext,
  type SearchOptions,
  type SearchResult,
} from "../services/memory/search.js";
import { FileSecretService } from "../services/secrets/FileSecretService.js";
import { createEmbeddingDatabase } from "../stores/embeddings/embedding-database.js";
import { SqliteEmbeddingStore } from "../stores/embeddings/SqliteEmbeddingStore.js";

export type { SearchOptions, SearchResult } from "../services/memory/search.js";

function createStandaloneContext(): Context {
  const userDir = resolve(process.cwd(), "user");
  return new ObjectContext({
    secretsPath: () => join(userDir, "secrets.json"),
    piAuthPath: () => resolve(homedir(), ".pi", "agent", "auth.json"),
    secretService: () => new FileSecretService(),
    embeddingDb: () => createEmbeddingDatabase(join(userDir, "embeddings.db")),
    embeddingStore: () => new SqliteEmbeddingStore(),
    embeddingService: () => new OpenAiEmbeddingService(),
  });
}

export async function searchMemory(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const x = createStandaloneContext();
  try {
    return await searchMemoryInContext(x, query, options);
  } finally {
    xEmbeddingDb(x).close();
  }
}

export function getLastEmbeddedMessageId(sessionId: string): number {
  const x = createStandaloneContext();
  try {
    return getLastEmbeddedMessageIdInContext(x, sessionId);
  } finally {
    xEmbeddingDb(x).close();
  }
}
