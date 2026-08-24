export {
  authQueryKey,
  authResultSchema,
  authStatusSchema,
  useAuthStatus,
  useLogin,
  useLogout,
  useSetup,
  type AuthStatus,
} from "@vito/client";

export type AuthResult = import("zod").infer<typeof import("@vito/client").authResultSchema>;
