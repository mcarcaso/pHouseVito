import type { Context } from "../../context/Context.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
export const mcpOAuthEntrySchema = z
  .object({
    tokens: z
      .unknown()
      .transform((value) => OAuthTokensSchema.parse(value))
      .optional(),
    client: z
      .unknown()
      .transform((value) => OAuthClientInformationSchema.parse(value))
      .optional(),
    expiresAt: z.number().optional(),
    redirectUrl: z.string().optional(),
  })
  .strict();
export type McpOAuthEntry = z.infer<typeof mcpOAuthEntrySchema>;
export interface McpOAuthStore {
  get(x: Context, serverUrl: string): McpOAuthEntry;
  save(x: Context, serverUrl: string, entry: McpOAuthEntry): void;
  remove(x: Context, serverUrl: string): void;
}
