/**
 * Shared OpenAI-compatible client & embedding function for the memory pipeline.
 * Tries OpenRouter first, falls back to native OpenAI if no OpenRouter key.
 * Used by embeddings.ts, search.ts, profile.ts, and dashboard search.
 */

import OpenAI from "openai";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { EMBEDDING_MODEL } from "./models.js";

const ROOT = resolve(process.cwd());

// ── Provider detection ────────────────────────────────────

interface ProviderConfig {
  apiKey: string;
  baseURL?: string;        // undefined = native OpenAI default
  isOpenRouter: boolean;
}

let providerConfig: ProviderConfig | null = null;

function getProviderConfig(): ProviderConfig {
  if (providerConfig) return providerConfig;

  const secrets = JSON.parse(readFileSync(join(ROOT, "user", "secrets.json"), "utf-8"));

  if (secrets.OPENROUTER_API_KEY) {
    providerConfig = {
      apiKey: secrets.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      isOpenRouter: true,
    };
  } else if (secrets.OPENAI_API_KEY) {
    providerConfig = {
      apiKey: secrets.OPENAI_API_KEY,
      isOpenRouter: false,
    };
  } else {
    throw new Error("No API key found: set OPENROUTER_API_KEY or OPENAI_API_KEY in user/secrets.json");
  }

  return providerConfig;
}

// ── Shared client ─────────────────────────────────────────

let clientInstance: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!clientInstance) {
    const config = getProviderConfig();
    clientInstance = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }
  return clientInstance;
}

/**
 * Resolve model name for the active provider.
 * OpenRouter uses "openai/gpt-4o-mini" format; native OpenAI uses "gpt-4o-mini".
 */
export function resolveModel(openRouterModel: string): string {
  const config = getProviderConfig();
  if (config.isOpenRouter) return openRouterModel;
  // Strip provider prefix for native OpenAI (e.g. "openai/gpt-4o-mini" → "gpt-4o-mini")
  return openRouterModel.includes("/") ? openRouterModel.split("/").slice(1).join("/") : openRouterModel;
}

// ── Embedding helper ──────────────────────────────────────

/**
 * Embed text using the shared embedding model.
 * Works with either OpenRouter or native OpenAI.
 */
export async function createEmbedding(text: string): Promise<Float32Array> {
  const openai = getClient();
  const response = await openai.embeddings.create({
    model: resolveModel(EMBEDDING_MODEL),
    input: text,
  });
  return new Float32Array(response.data[0].embedding);
}
