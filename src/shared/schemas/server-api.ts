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
  system: z.object({
    cpuUsage: z.number().min(0).max(100),
    memoryTotal: z.number().nonnegative(),
    memoryUsed: z.number().nonnegative(),
    memoryFree: z.number().nonnegative(),
  }),
});

export const serverRestartResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});
