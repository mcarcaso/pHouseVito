import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import {
  cronJobPatchSchema,
  isScriptJob,
  scriptJobConfigSchema,
  type ScriptJobConfig,
} from "../shared/schemas/vito-config.js";
import { xCronService, xJobService, xLogsDir, xSessionStore, xVitoService } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";

const jobParamsSchema = z.object({ name: z.string().min(1) });
const runParamsSchema = z.object({ id: z.string().uuid() });
const runsQuerySchema = z
  .object({
    name: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
  })
  .strict();

function validateScript(job: ScriptJobConfig): string | undefined {
  if (!isAbsolute(job.script) || !job.script.endsWith(".ts")) {
    return "Job script must be an absolute .ts file";
  }
  if (!existsSync(job.script) || !statSync(job.script).isFile()) {
    return "Job script must be an existing file";
  }
  return undefined;
}

function sessionExists(x: Context, session: string | undefined): boolean {
  if (!session) return true;
  return Boolean(xSessionStore(x).list(x, { ids: [session], limit: 1 })[0]);
}

export class CronRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/jobs",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => {
        const jobs = xVitoService(routeX).getConfiguredJobs(routeX);
        const health = xCronService(routeX).checkHealth(routeX);
        const healthByName = new Map(health.map((entry) => [entry.name, entry]));
        return jobs.map((job) => ({
          ...job,
          legacy: !isScriptJob(job),
          nextRun: healthByName.get(job.name)?.nextRun?.toISOString() || null,
          isActive: healthByName.get(job.name)?.isActive ?? false,
        }));
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/jobs",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: scriptJobConfigSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { body }, res }) => {
        const scriptError = validateScript(body);
        if (scriptError) {
          res.status(400).json({ error: scriptError });
          return;
        }
        if (!sessionExists(routeX, body.session)) {
          res.status(400).json({ error: `Session '${body.session}' does not exist` });
          return;
        }
        const vito = xVitoService(routeX);
        const config = vito.getConfig(routeX);
        if (config.cron.jobs.some((job) => job.name === body.name)) {
          res.status(409).json({ error: "Job with this name already exists" });
          return;
        }
        const scheduleError = xCronService(routeX).getScheduleError(
          routeX,
          body,
          config.settings.timezone,
        );
        if (scheduleError) {
          res.status(400).json({ error: scheduleError });
          return;
        }
        config.cron.jobs.push(body);
        vito.saveConfig(routeX, config);
        xCronService(routeX).scheduleJob(routeX, body);
        return body;
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/jobs/:name",
      auth: "dashboard",
      schemas: { params: jobParamsSchema, query: emptyRouteSchema, body: cronJobPatchSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, body }, res }) => {
        const vito = xVitoService(routeX);
        const config = vito.getConfig(routeX);
        const index = config.cron.jobs.findIndex((job) => job.name === params.name);
        if (index === -1) {
          res.status(404).json({ error: "Job not found" });
          return;
        }
        const existing = config.cron.jobs[index];
        if (!isScriptJob(existing)) {
          res.status(409).json({ error: "Convert this legacy job before editing it" });
          return;
        }
        const candidate = scriptJobConfigSchema.parse({ ...existing, ...body, name: params.name });
        const scriptError = validateScript(candidate);
        if (scriptError) {
          res.status(400).json({ error: scriptError });
          return;
        }
        if (!sessionExists(routeX, candidate.session)) {
          res.status(400).json({ error: `Session '${candidate.session}' does not exist` });
          return;
        }
        const scheduleError = xCronService(routeX).getScheduleError(
          routeX,
          candidate,
          config.settings.timezone,
        );
        if (scheduleError) {
          res.status(400).json({ error: scheduleError });
          return;
        }
        config.cron.jobs[index] = candidate;
        vito.saveConfig(routeX, config);
        xCronService(routeX).reload(routeX, config.cron.jobs, config.settings.timezone);
        return candidate;
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/jobs/:name",
      auth: "dashboard",
      schemas: { params: jobParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, res }) => {
        const vito = xVitoService(routeX);
        const config = vito.getConfig(routeX);
        const jobs = config.cron.jobs.filter((job) => job.name !== params.name);
        if (jobs.length === config.cron.jobs.length) {
          res.status(404).json({ error: "Job not found" });
          return;
        }
        config.cron.jobs = jobs;
        vito.saveConfig(routeX, config);
        xCronService(routeX).removeJob(routeX, params.name);
        return { success: true };
      },
    });

    for (const [path, enabled] of [
      ["/jobs/:name/pause", false],
      ["/jobs/:name/resume", true],
    ] as const) {
      registerRoute(x, {
        router,
        method: "POST",
        path,
        auth: "dashboard",
        schemas: { params: jobParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
        responseSchema: jsonResponseSchema,
        handler: (routeX, { data: { params }, res }) => {
          const vito = xVitoService(routeX);
          const config = vito.getConfig(routeX);
          const index = config.cron.jobs.findIndex((job) => job.name === params.name);
          const existing = config.cron.jobs[index];
          if (!existing) {
            res.status(404).json({ error: "Job not found" });
            return;
          }
          if (!isScriptJob(existing)) {
            res.status(409).json({ error: "Convert this legacy job before changing its state" });
            return;
          }
          config.cron.jobs[index] = { ...existing, enabled };
          vito.saveConfig(routeX, config);
          xCronService(routeX).reload(routeX, config.cron.jobs, config.settings.timezone);
          return config.cron.jobs[index];
        },
      });
    }

    registerRoute(x, {
      router,
      method: "POST",
      path: "/jobs/:name/trigger",
      auth: "dashboard",
      schemas: { params: jobParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: async (routeX, { data: { params }, res }) => {
        const success = await xCronService(routeX).triggerJob(routeX, params.name);
        if (!success) {
          res.status(404).json({ error: "Job not found" });
          return;
        }
        return { success: true, message: `Job '${params.name}' triggered` };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/jobs/:name/logs",
      auth: "dashboard",
      schemas: { params: jobParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, res }) => {
        const configured = xVitoService(routeX)
          .getConfiguredJobs(routeX)
          .find((job) => job.name === params.name);
        if (!configured || !isScriptJob(configured)) {
          res.status(404).json({ error: "Script job not found" });
          return;
        }
        const path = join(xLogsDir(routeX), "jobs", `${configured.name}.log`);
        if (!existsSync(path)) return { name: configured.name, log: "" };
        return { name: configured.name, log: readFileSync(path, "utf-8").slice(-1024 * 1024) };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/runs",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: runsQuerySchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { query } }) => xJobService(routeX).runs(routeX, query),
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/runs/:id/cancel",
      auth: "dashboard",
      schemas: { params: runParamsSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, res }) => {
        if (!xJobService(routeX).cancel(routeX, params.id)) {
          res.status(404).json({ error: "Job run not found" });
          return;
        }
        return { cancelled: true };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/health",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX) => {
        const health = xCronService(routeX).checkHealth(routeX);
        return {
          summary: { total: health.length, active: health.filter((job) => job.isActive).length },
          jobs: health,
        };
      },
    });

    return router;
  }
}
