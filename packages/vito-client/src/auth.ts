import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson, useVitoClient } from "./client";

export const authStatusSchema = z.object({ passwordSet: z.boolean(), authenticated: z.boolean() });
export const authResultSchema = z.object({
  success: z.boolean().optional(),
  token: z.string().optional(),
  password: z.string().optional(),
  error: z.string().optional(),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;
export const authQueryKey = ["auth"] as const;

export function useAuthStatus() {
  const client = useVitoClient();
  return useQuery({
    queryKey: authQueryKey,
    queryFn: () => requestJson(client, "/api/auth/check", authStatusSchema),
    retry: false,
  });
}

export function useLogin() {
  const client = useVitoClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      requestJson(client, "/api/auth/login", authResultSchema, jsonRequest("POST", { password })),
    onSuccess: async (result) => {
      if (result.token) await client.tokenStore?.set(result.token);
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
  });
}

export function useSetup() {
  const client = useVitoClient();
  return useMutation({
    mutationFn: () => requestJson(client, "/api/auth/setup", authResultSchema, jsonRequest("POST")),
  });
}

export function useLogout() {
  const client = useVitoClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestJson(client, "/api/auth/logout", z.unknown(), { method: "POST" }),
    onSettled: async () => {
      await client.tokenStore?.set(null);
      queryClient.clear();
      queryClient.setQueryData<AuthStatus>(authQueryKey, {
        passwordSet: true,
        authenticated: false,
      });
    },
  });
}
