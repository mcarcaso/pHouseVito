import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { z } from "zod";

export interface TokenStore {
  get(): string | null | Promise<string | null>;
  set(value: string | null): void | Promise<void>;
}

export interface VitoClientOptions {
  baseUrl?: string;
  tokenStore?: TokenStore;
  onUnauthorized?: () => void;
  fetch?: typeof globalThis.fetch;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const errorSchema = z
  .object({ error: z.string().optional(), message: z.string().optional() })
  .passthrough();
const VitoClientContext = createContext<VitoClientOptions | null>(null);

export function createVitoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
  });
}

export function VitoClientProvider({
  options,
  children,
  queryClient,
}: {
  options: VitoClientOptions;
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? createVitoQueryClient());
  return (
    <VitoClientContext.Provider value={options}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </VitoClientContext.Provider>
  );
}

export function useVitoClient(): VitoClientOptions {
  const value = useContext(VitoClientContext);
  if (!value) throw new Error("VitoClientProvider is missing");
  return value;
}

export async function requestJson<Schema extends z.ZodTypeAny>(
  client: VitoClientOptions,
  path: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.output<Schema>> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = await client.tokenStore?.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await (client.fetch ?? globalThis.fetch)(`${client.baseUrl ?? ""}${path}`, {
    ...init,
    headers,
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401) client.onUnauthorized?.();
    const parsed = errorSchema.safeParse(body);
    throw new ApiError(
      parsed.success
        ? (parsed.data.error ?? parsed.data.message ?? `Request failed (${response.status})`)
        : `Request failed (${response.status})`,
      response.status,
      body,
    );
  }
  return schema.parse(body);
}

export function jsonRequest(method: "POST" | "PUT" | "PATCH", body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
