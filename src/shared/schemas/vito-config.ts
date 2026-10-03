import { localJobTime, resolveJobTime } from "../job-time.js";
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

export const modelSchema = z.object({
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
    customInstructions: z.string().optional(),
    requireMention: z.boolean().optional(),
    traceMessageUpdates: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    "pi-coding-agent": piRuntimeConfigSchema.partial().optional(),
    memory: z
      .object({
        chunkContextualizerModel: modelSchema.optional(),
        factExtractorModel: modelSchema.optional(),
        factIngestionMode: z.enum(["one-shot", "persistent-pi"]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type ParsedSettings = z.infer<typeof settingsSchema>;

function removeLegacySettings(settings: ParsedSettings): ParsedSettings {
  const { harness: _legacyHarness, streamMode: _legacyStreamMode, ...currentSettings } = settings;
  return currentSettings;
}

const settingsWriteSchema = settingsSchema.superRefine((settings, ctx) => {
  if ("streamMode" in settings) {
    ctx.addIssue({
      code: z.ZodIssueCode.unrecognized_keys,
      keys: ["streamMode"],
      path: [],
      message: "Unrecognized key: streamMode",
    });
  }
});

export const settingsPatchSchema = z
  .object({
    customInstructions: z.string().nullable().optional(),
    requireMention: z.boolean().nullable().optional(),
    traceMessageUpdates: z.boolean().nullable().optional(),
    timezone: timezoneSchema.nullable().optional(),
    "pi-coding-agent": piRuntimeConfigSchema.partial().nullable().optional(),
    memory: z
      .object({
        chunkContextualizerModel: modelSchema.optional(),
        factExtractorModel: modelSchema.optional(),
        factIngestionMode: z.enum(["one-shot", "persistent-pi"]).optional(),
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
    allowedUserIds: z.array(z.string()).optional(),
    allowDms: z.boolean().optional(),
    ownerIds: z.array(z.string()).optional(),
  })
  .passthrough();

const channelConfigWriteSchema = channelConfigSchema.superRefine((channel, ctx) => {
  if ("streamMode" in channel) {
    ctx.addIssue({
      code: z.ZodIssueCode.unrecognized_keys,
      keys: ["streamMode"],
      path: [],
      message: "Unrecognized key: streamMode",
    });
  }
  if (channel.settings && "streamMode" in channel.settings) {
    ctx.addIssue({
      code: z.ZodIssueCode.unrecognized_keys,
      keys: ["streamMode"],
      path: ["settings"],
      message: "Unrecognized key: streamMode",
    });
  }
});

export const legacyCronJobConfigSchema = z
  .object({
    name: z.string().min(1, "Job name is required"),
    schedule: z.string().min(1, "Job schedule is required"),
    timezone: timezoneSchema.default("America/Toronto"),
    session: z.string().min(1, "Job session is required"),
    prompt: z.string().min(1, "Job prompt is required"),
    oneTime: z.boolean().optional(),
    sendCondition: z.string().optional(),
    precheckCommand: z.string().optional(),
  })
  .passthrough();

export const scriptJobScheduleSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object" && "at" in value) {
      const v = value as { at: string; timezone?: string };
      const timezone = v.timezone ?? "America/Toronto";
      if (
        typeof v.at === "string" &&
        /(?:Z|[+-]\d{2}:\d{2})$/.test(v.at) &&
        Number.isFinite(Date.parse(v.at))
      )
        return { ...v, timezone, at: localJobTime(v.at, timezone) };
    }
    return value;
  },
  z
    .union([
      z
        .object({
          at: z.string(),
          timezone: timezoneSchema.default("America/Toronto"),
        })
        .strict(),
      z
        .object({
          cron: z.string().min(1, "Cron schedule is required"),
          timezone: timezoneSchema.default("America/Toronto"),
        })
        .strict(),
    ])
    .superRefine((schedule, ctx) => {
      if ("at" in schedule) {
        try {
          resolveJobTime(schedule.at, schedule.timezone);
        } catch (error) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(error), path: ["at"] });
        }
      }
    }),
);

export const jobDeliverySchema = z
  .object({
    channel: z.string().min(1),
    target: z.string().min(1),
  })
  .strict();

export const scriptJobConfigSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    script: z.string().min(1),
    schedule: scriptJobScheduleSchema,
    session: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
    enabled: z.boolean().default(true),
    delivery: jobDeliverySchema.optional(),
  })
  .strict();

/** Existing declarative jobs remain readable; all new writes use scriptJobConfigSchema. */
export const cronJobConfigSchema = z.union([scriptJobConfigSchema, legacyCronJobConfigSchema]);

export const cronJobPatchSchema = scriptJobConfigSchema.omit({ name: true }).partial().strict();

export const vitoConfigPatchSchema = z
  .object({
    bot: botConfigSchema.partial().optional(),
    apps: appsConfigSchema.partial().optional(),
    settings: settingsWriteSchema.optional(),
    channels: z.record(z.string(), channelConfigWriteSchema).optional(),
    sessions: z.record(z.string(), settingsWriteSchema).nullable().optional(),
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
    const settings = removeLegacySettings(currentConfig.settings);
    const channels = Object.fromEntries(
      Object.entries(currentConfig.channels).map(([name, channel]) => {
        const { streamMode: _legacyStreamMode, ...currentChannel } = channel;
        return [
          name,
          currentChannel.settings
            ? { ...currentChannel, settings: removeLegacySettings(currentChannel.settings) }
            : currentChannel,
        ];
      }),
    );
    const sessions = currentConfig.sessions
      ? Object.fromEntries(
          Object.entries(currentConfig.sessions).map(([key, sessionSettings]) => [
            key,
            removeLegacySettings(sessionSettings),
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

export type ModelConfig = z.infer<typeof modelSchema>;
export type PiRuntimeConfig = z.infer<typeof piRuntimeConfigSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ChannelConfig = z.infer<typeof channelConfigSchema>;
export type LegacyCronJobConfig = z.infer<typeof legacyCronJobConfigSchema>;
export type ScriptJobConfig = z.infer<typeof scriptJobConfigSchema>;
export type CronJobConfig = z.infer<typeof cronJobConfigSchema>;

export function isScriptJob(job: CronJobConfig): job is ScriptJobConfig {
  return "script" in job;
}
export type VitoConfig = z.infer<typeof vitoConfigSchema>;
export type VitoConfigPatch = z.infer<typeof vitoConfigPatchSchema>;

export type ResolvedSettings = {
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
