import { execa } from "execa";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { appNameSchema } from "../../shared/contracts/app.js";
import type {
  AppProcessService,
  AppProcessStatus,
} from "./AppProcessService.js";

const pm2ProcessSchema = z.object({
  name: z.string(),
  pm2_env: z.object({
    status: z.string().optional(),
    pm_uptime: z.number().optional(),
    restart_time: z.number().optional(),
  }).passthrough().optional(),
  monit: z.object({
    memory: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

interface CommandOptions {
  timeout: number;
  env: NodeJS.ProcessEnv;
}

type CommandRunner = (
  file: string,
  args: string[],
  options: CommandOptions
) => Promise<{ stdout: string }>;

const defaultRunner: CommandRunner = async (file, args, options) => {
  const result = await execa(file, args, options);
  return { stdout: result.stdout };
};

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin`,
  };
}

export class Pm2AppProcessService implements AppProcessService {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  async list(_x: Context, appNames?: string[]): Promise<AppProcessStatus[]> {
    try {
      const result = await this.run("npx", ["pm2", "jlist"], {
        timeout: 10_000,
        env: processEnvironment(),
      });
      const processes = z.array(pm2ProcessSchema).parse(JSON.parse(result.stdout));
      const names = appNames ? new Set(appNames.map((name) => `app-${name}`)) : undefined;
      return processes
        .filter((process) => process.name.startsWith("app-") && (!names || names.has(process.name)))
        .map((process) => ({
          name: process.name.slice("app-".length),
          status: process.pm2_env?.status ?? "unknown",
          uptime: process.pm2_env?.pm_uptime
            ? Math.max(0, Date.now() - process.pm2_env.pm_uptime)
            : null,
          restarts: process.pm2_env?.restart_time ?? 0,
          memory: process.monit?.memory ?? null,
        }));
    } catch {
      return [];
    }
  }

  async execute(
    _x: Context,
    args: { action: "start" | "stop" | "restart" | "delete"; appName: string }
  ): Promise<void> {
    const appName = appNameSchema.parse(args.appName);
    await this.run("npx", ["pm2", args.action, `app-${appName}`], {
      timeout: 30_000,
      env: processEnvironment(),
    });
  }
}
