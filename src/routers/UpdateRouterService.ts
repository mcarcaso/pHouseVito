import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { verifyUpdateManifest } from "../cli/update-manifest.js";
import { homedir } from "node:os";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import type { RouterService } from "./RouterService.js";
import { xProjectDir } from "../lib/x.js";
import { requestApply, updateStatus } from "../cli/update-apply.js";
import { registerRoute, emptyRouteSchema, unknownRouteSchema } from "./register-route.js";
const exec = promisify(execFile);
const schemas = { params: emptyRouteSchema, query: emptyRouteSchema, body: emptyRouteSchema };

export class UpdateRouterService implements RouterService {
  async createRouter(x: Context): Promise<express.Router> {
    const router = express.Router();
    registerRoute(x, {
      router,
      method: "GET",
      path: "/server/update/status",
      auth: "dashboard",
      schemas: { ...schemas, body: unknownRouteSchema },
      responseSchema: z.record(z.string(), z.unknown()),
      handler: (routeX) => updateStatus(xProjectDir(routeX)),
    });
    for (const action of ["check", "stage"] as const) {
      registerRoute(x, {
        router,
        method: "POST",
        path: `/server/update/${action}`,
        auth: "dashboard",
        schemas,
        responseSchema: z.object({
          output: z.string(),
          stagedPlan: z
            .object({
              version: z.string(),
              revision: z.string(),
              dataImpact: z.record(z.string(), z.unknown()),
            })
            .optional(),
        }),
        handler: async (routeX) => {
          const root = xProjectDir(routeX);
          const { stdout } = await exec(
            process.execPath,
            [join(root, "dist/cli/vito.js"), "update", action],
            { cwd: root, timeout: 240_000, maxBuffer: 1024 * 1024 },
          );
          const output = stdout.trim();
          const staged = action === "stage" ? /^Verified and staged: (.+)$/m.exec(output) : null;
          if (!staged) return { output };
          const directory = dirname(staged[1]);
          const manifest = verifyUpdateManifest(
            await readFile(join(directory, "update-manifest.json")),
            (await readFile(join(directory, "update-manifest.sig"), "utf8")).trim(),
          );
          return {
            output,
            stagedPlan: {
              version: manifest.version,
              revision: manifest.revision,
              dataImpact: manifest.schema === 2 ? manifest.dataImpact : { kind: "unknown" },
            },
          };
        },
      });
    }
    registerRoute(x, {
      router,
      method: "POST",
      path: "/server/update/apply",
      auth: "dashboard",
      schemas: {
        ...schemas,
        body: z
          .object({
            version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
            revision: z.string().regex(/^[a-f0-9]{40}$/),
            approved: z.literal(true),
            approveMigration: z.boolean().default(false),
          })
          .strict(),
      },
      responseSchema: z.object({ queued: z.literal(true) }),
      handler: async (routeX, { data: { body } }) => {
        await requestApply(
          xProjectDir(routeX),
          join(homedir(), ".vito/updates", body.version),
          body.revision,
          body.approveMigration,
        );
        return { queued: true as const };
      },
    });
    return router;
  }
}
