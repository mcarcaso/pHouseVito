import { z } from "zod";

const timezoneSchema = z
  .string()
  .min(1)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");

const modelSchema = z.object({
  provider: z.string().min(1, "Model provider is required"),
  name: z.string().min(1, "Model name is required"),
});

export const piRuntimeConfigSchema = z
  .object({
    model: modelSchema,
    openRouterProvider: z.string().min(1).optional(),
    thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
  })
  .passthrough();

export const settingsSchema = z
  .object({
    streamMode: z.enum(["stream", "bundled", "final"]).optional(),
    customInstructions: z.string().optional(),
    requireMention: z.boolean().optional(),
    traceMessageUpdates: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    "pi-coding-agent": piRuntimeConfigSchema.partial().optional(),
    memory: z
      .object({
        chunkContextualizerModel: modelSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type ParsedSettings = z.infer<typeof settingsSchema>;

function removeLegacyHarnessSelector(settings: ParsedSettings): ParsedSettings {
  const { harness: _legacyHarness, ...currentSettings } = settings;
  return currentSettings;
}

export const streamModeSchema = z.enum(["stream", "bundled", "final"]);

export const streamModeUpdateSchema = z
  .object({
    streamMode: streamModeSchema,
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    streamMode: streamModeSchema.nullable().optional(),
    customInstructions: z.string().nullable().optional(),
    requireMention: z.boolean().nullable().optional(),
    traceMessageUpdates: z.boolean().nullable().optional(),
    timezone: timezoneSchema.nullable().optional(),
    "pi-coding-agent": piRuntimeConfigSchema.partial().nullable().optional(),
    memory: z
      .object({
        chunkContextualizerModel: modelSchema.optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .strict();

export const botConfigSchema = z
  .object({
    name: z.string().min(1, "Bot name is required"),
  })
  .passthrough();

export const appsConfigSchema = z
  .object({
    baseDomain: z.string().min(1).optional(),
    portStart: z.number().int().min(1).max(65_535).optional(),
  })
  .passthrough();

const legacyHarnessesConfigSchema = z
  .object({
    "pi-coding-agent": piRuntimeConfigSchema.optional(),
  })
  .passthrough();

const channelIdentifierSchema = z
  .union([z.string(), z.number().int()])
  .transform((value) => String(value));

export const channelConfigSchema = z
  .object({
    enabled: z.boolean(),
    settings: settingsSchema.optional(),
    allowedChatIds: z.array(channelIdentifierSchema).optional(),
    allowedGuildIds: z.array(z.string()).optional(),
    allowedChannelIds: z.array(z.string()).optional(),
    streamMode: z.enum(["stream", "bundled", "final"]).optional(),
  })
  .passthrough();

export const cronJobConfigSchema = z
  .object({
    name: z.string().min(1, "Job name is required"),
    schedule: z.string().min(1, "Job schedule is required"),
    timezone: timezoneSchema.optional(),
    session: z.string().min(1, "Job session is required"),
    prompt: z.string().min(1, "Job prompt is required"),
    oneTime: z.boolean().optional(),
    sendCondition: z.string().optional(),
    precheckCommand: z.string().optional(),
  })
  .passthrough();

export const cronJobPatchSchema = z
  .object({
    schedule: z.string().min(1, "Job schedule is required").optional(),
    timezone: timezoneSchema.optional(),
    session: z.string().min(1, "Job session is required").optional(),
    prompt: z.string().min(1, "Job prompt is required").optional(),
    oneTime: z.boolean().optional(),
    sendCondition: z.string().nullable().optional(),
    precheckCommand: z.string().optional(),
  })
  .strict();

export const vitoConfigPatchSchema = z
  .object({
    bot: botConfigSchema.partial().optional(),
    apps: appsConfigSchema.partial().optional(),
    settings: settingsSchema.optional(),
    channels: z.record(z.string(), channelConfigSchema).optional(),
    sessions: z.record(z.string(), settingsSchema).nullable().optional(),
    compaction: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const vitoConfigSchema = z
  .object({
    bot: botConfigSchema.optional(),
    apps: appsConfigSchema.optional(),
    settings: settingsSchema,
    harnesses: legacyHarnessesConfigSchema.optional(),
    channels: z.record(z.string(), channelConfigSchema),
    sessions: z.record(z.string(), settingsSchema).optional(),
    cron: z
      .object({
        jobs: z.array(cronJobConfigSchema),
      })
      .passthrough(),
    compaction: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    const seenJobNames = new Set<string>();
    for (const [index, job] of config.cron.jobs.entries()) {
      if (seenJobNames.has(job.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cron", "jobs", index, "name"],
          message: `Duplicate cron job name: ${job.name}`,
        });
      }
      seenJobNames.add(job.name);
    }
  })
  .transform((config) => {
    const { harnesses, ...currentConfig } = config;
    const settings = removeLegacyHarnessSelector(currentConfig.settings);
    const channels = Object.fromEntries(
      Object.entries(currentConfig.channels).map(([name, channel]) => [
        name,
        channel.settings
          ? { ...channel, settings: removeLegacyHarnessSelector(channel.settings) }
          : channel,
      ]),
    );
    const sessions = currentConfig.sessions
      ? Object.fromEntries(
          Object.entries(currentConfig.sessions).map(([key, sessionSettings]) => [
            key,
            removeLegacyHarnessSelector(sessionSettings),
          ]),
        )
      : undefined;
    const legacyPi = harnesses?.["pi-coding-agent"];
    return {
      ...currentConfig,
      settings: {
        ...settings,
        ...(legacyPi || settings["pi-coding-agent"]
          ? {
              "pi-coding-agent": {
                ...legacyPi,
                ...settings["pi-coding-agent"],
              },
            }
          : {}),
      },
      channels,
      ...(sessions ? { sessions } : {}),
    };
  });

export type PiRuntimeConfig = z.infer<typeof piRuntimeConfigSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ChannelConfig = z.infer<typeof channelConfigSchema>;
export type CronJobConfig = z.infer<typeof cronJobConfigSchema>;
export type VitoConfig = z.infer<typeof vitoConfigSchema>;
export type VitoConfigPatch = z.infer<typeof vitoConfigPatchSchema>;

export type ResolvedSettings = Required<Pick<Settings, "streamMode">> & {
  customInstructions?: string;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  timezone?: string;
  "pi-coding-agent"?: Partial<PiRuntimeConfig>;
  memory?: Settings["memory"];
};

export interface ConfigValidationIssue {
  path: string;
  message: string;
  code: string;
}

export type ConfigValidationResult =
  { valid: true; config: VitoConfig } | { valid: false; issues: ConfigValidationIssue[] };

export function validateVitoConfig(value: unknown): ConfigValidationResult {
  const result = vitoConfigSchema.safeParse(value);
  if (result.success) {
    return { valid: true, config: result.data };
  }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
      message: issue.message,
      code: issue.code,
    })),
  };
}
