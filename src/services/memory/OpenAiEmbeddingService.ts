import OpenAI from "openai";
import type { Context } from "../../context/Context.js";
import { xSecretService } from "../../lib/x.js";
import type { EmbeddingService } from "./EmbeddingService.js";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export class OpenAiEmbeddingService implements EmbeddingService {
  private client?: OpenAI;
  private clientIdentity = "";

  private getClient(x: Context): { client: OpenAI; model: string } {
    const openAiKey = xSecretService(x).get(x, "OPENAI_API_KEY");
    const openRouterKey = xSecretService(x).get(x, "OPENROUTER_API_KEY");
    const apiKey = openAiKey || openRouterKey;
    if (!apiKey) {
      throw new Error("No API key found: configure OPENAI_API_KEY or OPENROUTER_API_KEY");
    }
    const baseURL = openAiKey ? undefined : "https://openrouter.ai/api/v1";
    const identity = `${baseURL ?? "openai"}:${apiKey}`;
    if (!this.client || this.clientIdentity !== identity) {
      this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
      this.clientIdentity = identity;
    }
    return {
      client: this.client,
      model: openAiKey ? EMBEDDING_MODEL.split("/").slice(1).join("/") : EMBEDDING_MODEL,
    };
  }

  async create(x: Context, text: string): Promise<Float32Array> {
    return (await this.createMany(x, [text]))[0];
  }

  async createMany(x: Context, texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const { client, model } = this.getClient(x);
    const response = await client.embeddings.create({ model, input: texts });
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== texts.length)
      throw new Error("Embedding provider returned incomplete data");
    return ordered.map((item) => new Float32Array(item.embedding));
  }
}
