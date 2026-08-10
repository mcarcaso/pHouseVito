import { z } from "zod";

export const serverHealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
});

export const serverStatusResponseSchema = z.object({
  uptime: z.number(),
  pid: z.number().int(),
  nodeVersion: z.string(),
  memoryUsage: z.object({
    rss: z.number(),
    heapTotal: z.number(),
    heapUsed: z.number(),
    external: z.number(),
    arrayBuffers: z.number(),
  }),
});

export const serverRestartResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});
