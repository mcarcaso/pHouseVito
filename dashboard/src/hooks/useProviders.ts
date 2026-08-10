import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson } from "../lib/api-client";

const providerOverviewSchema = z.object({
  providers: z.array(z.string()),
  keyStatus: z.record(z.boolean()),
  authStatus: z.record(
    z.object({
      hasAuth: z.boolean(),
      authType: z.string().optional(),
      expiresAt: z.number().optional(),
    }),
  ),
  keyInfo: z.record(z.object({ envVar: z.string(), description: z.string() })),
  oauthProviders: z.array(z.object({ id: z.string(), name: z.string() })),
});
const modelsSchema = z.array(z.object({ id: z.string() }).passthrough());
const loginStartSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("already_authenticated") }),
  z.object({
    status: z.literal("login_started"),
    url: z.string(),
    instructions: z.string().optional(),
  }),
  z.object({
    status: z.literal("device_code_started"),
    userCode: z.string(),
    verificationUri: z.string(),
    intervalSeconds: z.number().optional(),
    expiresInSeconds: z.number().optional(),
  }),
]);
const loginStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["none", "pending", "success"]) }),
  z.object({ status: z.literal("prompt"), promptMessage: z.string() }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);

const providersKey = ["providers"] as const;

export function useProviders() {
  return useQuery({
    queryKey: providersKey,
    queryFn: () => requestJson("/api/models/providers", providerOverviewSchema),
  });
}

export function useModels(provider: string) {
  return useQuery({
    queryKey: ["models", provider],
    queryFn: () => requestJson(`/api/models/${encodeURIComponent(provider)}`, modelsSchema),
    enabled: provider.length > 0,
  });
}

export function useProviderLoginStatus(providerId: string | null) {
  return useQuery({
    queryKey: ["provider-login", providerId],
    queryFn: () =>
      requestJson(
        `/api/auth/provider/${encodeURIComponent(providerId ?? "")}/login/status`,
        loginStatusSchema,
      ),
    enabled: providerId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "success" || status === "error" ? false : 2_000;
    },
    retry: false,
  });
}

export function useStartProviderLogin() {
  return useMutation({
    mutationFn: (providerId: string) =>
      requestJson(`/api/auth/provider/${encodeURIComponent(providerId)}/login`, loginStartSchema, {
        method: "POST",
      }),
  });
}

export function useSubmitProviderPrompt() {
  return useMutation({
    mutationFn: ({ providerId, value }: { providerId: string; value: string }) =>
      requestJson(
        `/api/auth/provider/${encodeURIComponent(providerId)}/login/prompt`,
        z.unknown(),
        jsonRequest("POST", { value }),
      ),
  });
}

export function useProviderLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      requestJson(`/api/auth/provider/${encodeURIComponent(providerId)}/logout`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providersKey }),
  });
}
