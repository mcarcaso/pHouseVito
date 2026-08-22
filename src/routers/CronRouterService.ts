import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import {
  cronJobConfigSchema,
  cronJobPatchSchema,
  type CronJobConfig,
} from "../shared/schemas/vito-config.js";
import { xCronService, xSessionStore, xVitoService } from "../lib/x.js";
import { emptyRouteSchema, unknownRouteSchema, registerRoute } from "./register-route.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
const jobParamsSchema = z.object({
  name: z.string().min(1),
});

function cleanJob(job: CronJobConfig): CronJobConfig {
  if (job.sendCondition === "" || job.sendCondition === undefined) {
    const cleaned = { ...job };
    delete cleaned.sendCondition;
    return cleaned;
  }
  return job;
}

export class CronRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "GET",
      path: "/jobs",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        const jobs = xVitoService(routeX).getConfiguredJobs(routeX);
        const health = xCronService(routeX).checkHealth(routeX);
        const healthByName = new Map(health.map((entry) => [entry.name, entry]));
        return jobs.map((job) => ({
          ...job,
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
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: cronJobConfigSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { body }, req: _req, res }) => {
        if (
          !xSessionStore(routeX).list(routeX, {
            ids: [body.session],
            limit: 1,
          })[0]
        ) {
          res.status(400).json({ error: `Session '${body.session}' does not exist` });
          return;
        }

        const vitoService = xVitoService(routeX);
        const config = vitoService.getConfig(routeX);
        if (config.cron.jobs.some((job) => job.name === body.name)) {
          res.status(400).json({ error: "Job with this name already exists" });
          return;
        }

        const job = cleanJob(body);
        const scheduleError = xCronService(routeX).getScheduleError(
          routeX,
          job,
          config.settings.timezone,
        );
        if (scheduleError) {
          res.status(400).json({
            error: "Invalid request",
            issues: [
              {
                path: "body.schedule",
                message: scheduleError,
                code: "custom",
              },
            ],
          });
          return;
        }

        config.cron.jobs.push(job);
        vitoService.saveConfig(routeX, config);
        const cronService = xCronService(routeX);
        cronService.scheduleJob(routeX, job);
        const jobHealth = cronService.checkHealth(routeX).find((entry) => entry.name === job.name);
        return {
          ...job,
          nextRun: jobHealth?.nextRun?.toISOString() || null,
        };
      },
    });

    registerRoute(x, {
      router,
      method: "PUT",
      path: "/jobs/:name",
      auth: "dashboard",
      schemas: {
        params: jobParamsSchema,
        query: emptyRouteSchema,
        body: cronJobPatchSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params, body }, req: _req, res }) => {
        const vitoService = xVitoService(routeX);
        const config = vitoService.getConfig(routeX);
        const index = config.cron.jobs.findIndex((job) => job.name === params.name);
        if (index === -1) {
          res.status(404).json({ error: "Job not found" });
          return;
        }

        const existing = config.cron.jobs[index];
        const candidate = cleanJob(
          cronJobConfigSchema.parse({
            ...existing,
            ...body,
            sendCondition:
              body.sendCondition === null
                ? undefined
                : (body.sendCondition ?? existing.sendCondition),
            name: params.name,
          }),
        );
        if (
          !xSessionStore(routeX).list(routeX, {
            ids: [candidate.session],
            limit: 1,
          })[0]
        ) {
          res.status(400).json({ error: `Session '${candidate.session}' does not exist` });
          return;
        }

        const scheduleError = xCronService(routeX).getScheduleError(
          routeX,
          candidate,
          config.settings.timezone,
        );
        if (scheduleError) {
          res.status(400).json({
            error: "Invalid request",
            issues: [
              {
                path: "body.schedule",
                message: scheduleError,
                code: "custom",
              },
            ],
          });
          return;
        }

        config.cron.jobs[index] = candidate;
        vitoService.saveConfig(routeX, config);
        const cronService = xCronService(routeX);
        cronService.removeJob(routeX, params.name);
        cronService.scheduleJob(routeX, candidate);
        return candidate;
      },
    });

    registerRoute(x, {
      router,
      method: "DELETE",
      path: "/jobs/:name",
      auth: "dashboard",
      schemas: {
        params: jobParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, req: _req, res }) => {
        const vitoService = xVitoService(routeX);
        const config = vitoService.getConfig(routeX);
        const jobs = config.cron.jobs.filter((job) => job.name !== params.name);
        if (jobs.length === config.cron.jobs.length) {
          res.status(404).json({ error: "Job not found" });
          return;
        }

        config.cron.jobs = jobs;
        vitoService.saveConfig(routeX, config);
        xCronService(routeX).removeJob(routeX, params.name);
        return { success: true };
      },
    });

    registerRoute(x, {
      router,
      method: "POST",
      path: "/jobs/:name/trigger",
      auth: "dashboard",
      schemas: {
        params: jobParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: async (routeX, { data: { params }, req: _req, res }) => {
        const success = await xCronService(routeX).triggerJob(routeX, params.name);
        if (!success) {
          res.status(404).json({ error: "Job not found" });
          return;
        }
        return {
          success: true,
          message: `Job '${params.name}' triggered`,
        };
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/health",
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: _input, req: _req, res }) => {
        const health = xCronService(routeX).checkHealth(routeX);
        return {
          summary: {
            total: health.length,
            active: health.filter((job) => job.isActive).length,
          },
          jobs: health,
        };
      },
    });

    return router;
  }
}
