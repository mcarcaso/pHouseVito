/** Shared OpenAI-compatible client and embedding function for memory. */

import OpenAI from "openai";
import { EMBEDDING_MODEL } from "./models.js";

interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  isOpenRouter: boolean;
}

function getProviderConfig(): ProviderConfig {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      isOpenRouter: false,
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      isOpenRouter: true,
    };
  }
  throw new Error(
    "No API key found: set OPENROUTER_API_KEY or OPENAI_API_KEY in user/secrets.json"
  );
}

let clientInstance: OpenAI | null = null;
let clientIdentity = "";

export function getClient(): OpenAI {
  const config = getProviderConfig();
  const identity = `${config.baseURL ?? "openai"}:${config.apiKey}`;
  if (!clientInstance || clientIdentity !== identity) {
    clientInstance = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    clientIdentity = identity;
  }
  return clientInstance;
}

export function resolveModel(openRouterModel: string): string {
  if (getProviderConfig().isOpenRouter) return openRouterModel;
  return openRouterModel.includes("/")
    ? openRouterModel.split("/").slice(1).join("/")
    : openRouterModel;
}

export async function createEmbedding(text: string): Promise<Float32Array> {
  const openai = getClient();
  const response = await openai.embeddings.create({
    model: resolveModel(EMBEDDING_MODEL),
    input: text,
  });
  return new Float32Array(response.data[0].embedding);
}
