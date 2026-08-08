import type { Context } from "../../context/Context.js";

export interface EmbeddingChunkWithVector {
  id: number;
  sessionId: string;
  day: string;
  chunkIndex: number;
  text: string;
  context: string | null;
  messageCount: number;
  vector: Float32Array;
}

export interface CreateEmbeddingChunkArgs {
  sessionId: string;
  day: string;
  chunkIndex: number;
  text: string;
  context: string;
  embeddedText: string;
  messageIdStart: number;
  messageIdEnd: number;
  messageCount: number;
  vector: Float32Array;
}

export interface EmbeddingSessionStats {
  sessionId: string;
  count: number;
  firstDay: string;
  lastDay: string;
}

export interface EmbeddingStats {
  totalChunks: number;
  totalSessions: number;
  totalDays: number;
  oldestDay: string | null;
  newestDay: string | null;
  sessions: EmbeddingSessionStats[];
}

export interface EmbeddingStore {
  getLastEmbeddedMessageId(x: Context, sessionId: string): number;
  getNextChunkIndices(x: Context, sessionId: string): Map<string, number>;
  getPreviousChunkText(x: Context, sessionId: string): string | null;
  createChunk(x: Context, args: CreateEmbeddingChunkArgs): number;
  listChunksWithVectors(x: Context, sessionId?: string): EmbeddingChunkWithVector[];
  searchFts(x: Context, args: {
    query: string;
    limit: number;
    sessionId?: string;
  }): Array<{ id: number; score: number }>;
  getStats(x: Context): EmbeddingStats;
}
