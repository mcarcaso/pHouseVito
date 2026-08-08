import { z } from "zod";

const timezoneSchema = z.string().min(1).refine((timezone) => {
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

export const piHarnessConfigSchema = z.object({
  model: modelSchema,
  openRouterProvider: z.string().min(1).optional(),
  thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
}).passthrough();

export const claudeCodeHarnessConfigSchema = z.object({
  model: modelSchema.optional(),
  permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan"]).optional(),
  binaryPath: z.string().min(1).optional(),
}).passthrough();

export const settingsSchema = z.object({
  harness: z.string().min(1).optional(),
  streamMode: z.enum(["stream", "bundled", "final"]).optional(),
  customInstructions: z.string().optional(),
  requireMention: z.boolean().optional(),
  traceMessageUpdates: z.boolean().optional(),
  timezone: timezoneSchema.optional(),
  "pi-coding-agent": piHarnessConfigSchema.partial().optional(),
  "claude-code": claudeCodeHarnessConfigSchema.partial().optional(),
  memory: z.object({
    chunkContextualizerModel: modelSchema.optional(),
  }).passthrough().optional(),
}).passthrough();

export const settingsPatchSchema = z.object({
  harness: z.string().min(1).nullable().optional(),
  streamMode: z.enum(["stream", "bundled", "final"]).nullable().optional(),
  customInstructions: z.string().nullable().optional(),
  requireMention: z.boolean().nullable().optional(),
  traceMessageUpdates: z.boolean().nullable().optional(),
  timezone: timezoneSchema.nullable().optional(),
  "pi-coding-agent": piHarnessConfigSchema.partial().nullable().optional(),
  "claude-code": claudeCodeHarnessConfigSchema.partial().nullable().optional(),
  memory: z.object({
    chunkContextualizerModel: modelSchema.optional(),
  }).passthrough().nullable().optional(),
}).strict();

export const botConfigSchema = z.object({
  name: z.string().min(1, "Bot name is required"),
}).passthrough();

export const appsConfigSchema = z.object({
  baseDomain: z.string().min(1).optional(),
  portStart: z.number().int().min(1).max(65_535).optional(),
}).passthrough();

export const harnessesConfigSchema = z.object({
  "pi-coding-agent": piHarnessConfigSchema.optional(),
  "claude-code": claudeCodeHarnessConfigSchema.optional(),
}).passthrough();

export const channelConfigSchema = z.object({
  enabled: z.boolean(),
  settings: settingsSchema.optional(),
  allowedChatIds: z.array(z.string()).optional(),
  allowedGuildIds: z.array(z.string()).optional(),
  allowedChannelIds: z.array(z.string()).optional(),
  streamMode: z.enum(["stream", "bundled", "final"]).optional(),
}).passthrough();

export const cronJobConfigSchema = z.object({
  name: z.string().min(1, "Job name is required"),
  schedule: z.string().min(1, "Job schedule is required"),
  timezone: timezoneSchema.optional(),
  session: z.string().min(1, "Job session is required"),
  prompt: z.string().min(1, "Job prompt is required"),
  oneTime: z.boolean().optional(),
  sendCondition: z.string().optional(),
  precheckCommand: z.string().optional(),
}).passthrough();

export const cronJobPatchSchema = z.object({
  schedule: z.string().min(1, "Job schedule is required").optional(),
  timezone: timezoneSchema.optional(),
  session: z.string().min(1, "Job session is required").optional(),
  prompt: z.string().min(1, "Job prompt is required").optional(),
  oneTime: z.boolean().optional(),
  sendCondition: z.string().nullable().optional(),
  precheckCommand: z.string().optional(),
}).strict();

export const vitoConfigPatchSchema = z.object({
  bot: botConfigSchema.partial().optional(),
  apps: appsConfigSchema.partial().optional(),
  settings: settingsSchema.optional(),
  harnesses: harnessesConfigSchema.partial().optional(),
  channels: z.record(z.string(), channelConfigSchema).optional(),
  sessions: z.record(z.string(), settingsSchema).nullable().optional(),
  compaction: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const vitoConfigSchema = z.object({
  bot: botConfigSchema.optional(),
  apps: appsConfigSchema.optional(),
  settings: settingsSchema,
  harnesses: harnessesConfigSchema,
  channels: z.record(z.string(), channelConfigSchema),
  sessions: z.record(z.string(), settingsSchema).optional(),
  cron: z.object({
    jobs: z.array(cronJobConfigSchema),
  }).passthrough(),
  compaction: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((config, ctx) => {
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
});

export type PiHarnessConfig = z.infer<typeof piHarnessConfigSchema>;
export type ClaudeCodeHarnessConfig = z.infer<typeof claudeCodeHarnessConfigSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ChannelConfig = z.infer<typeof channelConfigSchema>;
export type CronJobConfig = z.infer<typeof cronJobConfigSchema>;
export type VitoConfig = z.infer<typeof vitoConfigSchema>;
export type VitoConfigPatch = z.infer<typeof vitoConfigPatchSchema>;

export type ResolvedSettings = Required<Pick<Settings, "harness" | "streamMode">> & {
  customInstructions?: string;
  requireMention?: boolean;
  traceMessageUpdates?: boolean;
  timezone?: string;
  "pi-coding-agent"?: Partial<PiHarnessConfig>;
  "claude-code"?: Partial<ClaudeCodeHarnessConfig>;
  memory?: Settings["memory"];
};

export interface ConfigValidationIssue {
  path: string;
  message: string;
  code: string;
}

export type ConfigValidationResult =
  | { valid: true; config: VitoConfig }
  | { valid: false; issues: ConfigValidationIssue[] };

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
