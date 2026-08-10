import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { jsonRequest, requestJson } from "../lib/api-client";

const authStatusSchema = z.object({
  passwordSet: z.boolean(),
  authenticated: z.boolean(),
});

const authResultSchema = z.object({
  success: z.boolean().optional(),
  password: z.string().optional(),
  error: z.string().optional(),
});

export type AuthStatus = z.infer<typeof authStatusSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;

export const authQueryKey = ["auth"] as const;

export function useAuthStatus() {
  return useQuery({
    queryKey: authQueryKey,
    queryFn: () => requestJson("/api/auth/check", authStatusSchema),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      requestJson("/api/auth/login", authResultSchema, jsonRequest("POST", { password })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authQueryKey }),
  });
}

export function useSetup() {
  return useMutation({
    mutationFn: () => requestJson("/api/auth/setup", authResultSchema, jsonRequest("POST")),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestJson("/api/auth/logout", z.unknown(), { method: "POST" }),
    onSuccess: () =>
      queryClient.setQueryData<AuthStatus>(authQueryKey, {
        passwordSet: true,
        authenticated: false,
      }),
  });
}
