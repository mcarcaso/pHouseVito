import { z } from "zod";

export const dashboardLoginRequestSchema = z
  .object({
    password: z.unknown().optional(),
  })
  .passthrough();

export type DashboardLoginRequest = z.infer<typeof dashboardLoginRequestSchema>;
