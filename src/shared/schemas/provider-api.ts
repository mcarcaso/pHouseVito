import { z } from "zod";

export const providerIdSchema = z.string().min(1).max(200);

export const providerOverviewSchema = z.object({
  providers: z.array(z.string()),
  keyStatus: z.record(z.boolean()),
  authStatus: z.record(
    z.object({
      hasAuth: z.boolean(),
      authType: z.enum(["api_key", "oauth"]).nullable(),
      expiresAt: z.number().optional(),
    }),
  ),
  keyInfo: z.record(z.object({ envVar: z.string(), description: z.string() })),
  oauthProviders: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const providerModelsSchema = z.array(z.object({ id: z.string() }).passthrough());
export const providerLoginPromptRequestSchema = z
  .object({
    value: z.unknown().optional(),
  })
  .passthrough();

export type ProviderLoginPromptRequest = z.infer<typeof providerLoginPromptRequestSchema>;
export type ProviderOverviewResponse = z.infer<typeof providerOverviewSchema>;
