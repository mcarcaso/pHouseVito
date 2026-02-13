import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI(); // Uses OPENAI_API_KEY env var
  }
  return client;
}

/** Embed a single text string, returns Float32Array stored as Buffer */
export async function embed(
  text: string,
  model = "text-embedding-3-small"
): Promise<Buffer> {
  const response = await getClient().embeddings.create({
    model,
    input: text,
  });
  const vector = response.data[0].embedding;
  return Buffer.from(new Float32Array(vector).buffer);
}

/** Embed multiple texts in a batch */
export async function embedBatch(
  texts: string[],
  model = "text-embedding-3-small"
): Promise<Buffer[]> {
  if (texts.length === 0) return [];
  const response = await getClient().embeddings.create({
    model,
    input: texts,
  });
  return response.data.map((d) =>
    Buffer.from(new Float32Array(d.embedding).buffer)
  );
}

/** Cosine similarity between two embedding buffers */
export function cosineSimilarity(a: Buffer, b: Buffer): number {
  const va = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const vb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Find the top-K most similar memories to a query embedding */
export function findTopK(
  queryEmbedding: Buffer,
  candidates: Array<{ id: number; content: string; embedding: Buffer }>,
  k: number
): Array<{ id: number; content: string; score: number }> {
  const scored = candidates.map((c) => ({
    id: c.id,
    content: c.content,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
