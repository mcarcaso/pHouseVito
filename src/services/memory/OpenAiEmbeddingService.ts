import OpenAI from "openai";
import type { Context } from "../../context/Context.js";
import { xSecretService } from "../../lib/x.js";
import type { EmbeddingService } from "./EmbeddingService.js";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export class OpenAiEmbeddingService implements EmbeddingService {
  private client?: OpenAI;
  private clientIdentity = "";

  async create(x: Context, text: string): Promise<Float32Array> {
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

    const model = openAiKey ? EMBEDDING_MODEL.split("/").slice(1).join("/") : EMBEDDING_MODEL;
    const response = await this.client.embeddings.create({ model, input: text });
    const embedding = response.data[0]?.embedding;
    if (!embedding) throw new Error("Embedding provider returned no vector");
    return new Float32Array(embedding);
  }
}
