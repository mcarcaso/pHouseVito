import { z } from "zod";

export const slackMessageSchema = z.object({
  type: z.enum(["message", "app_mention"]),
  channel: z.string().regex(/^[CDG][A-Z0-9]+$/),
  user: z.string().min(1),
  ts: z.string().regex(/^\d+\.\d+$/),
  thread_ts: z
    .string()
    .regex(/^\d+\.\d+$/)
    .optional(),
  text: z.string().default(""),
  channel_type: z.string().optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
  files: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        mimetype: z.string().optional(),
        url_private_download: z.string().optional(),
        url_private: z.string().optional(),
      }),
    )
    .default([]),
});

export function slackTarget(team: string, channel: string, thread?: string): string {
  return [team, channel, ...(thread ? [thread] : [])].join(":");
}

export function parseSlackTarget(target: string): {
  team: string;
  channel: string;
  thread?: string;
} {
  const match = /^([A-Z0-9]+):([CDG][A-Z0-9]+)(?::(\d+\.\d+))?$/.exec(target);
  if (!match)
    throw new Error("Invalid Slack target; expected workspace:channel[:thread timestamp]");
  return { team: match[1], channel: match[2], thread: match[3] };
}

/** Preserve code while converting the markdown forms Slack's mrkdwn supports. */
export function slackMrkdwn(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) => {
      const escaped = part.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      if (index % 2) return escaped;
      return escaped
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
        .replace(/\*\*([^*]+)\*\*/g, "*$1*")
        .replace(/^#{1,6} (.+)$/gm, "*$1*");
    })
    .join("");
}
