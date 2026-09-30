import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import type { Context } from "../../context/Context.js";
import type {
  ServerHealth,
  ServerLifecycleService,
  ServerRestartRequest,
  ServerStatus,
} from "./ServerLifecycleService.js";

interface ServerRuntime {
  uptime(): number;
  readonly pid: number;
  readonly version: string;
  memoryUsage(): NodeJS.MemoryUsage;
}

interface SystemRuntime {
  cpus(): ReturnType<typeof os.cpus>;
  totalmem(): number;
  freemem(): number;
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

interface LifecycleCommand {
  file: string;
  args: string[];
  timeout?: number;
}

type CommandRunner = (command: LifecycleCommand) => Promise<void>;
type Scheduler = (callback: () => void, delayMs: number) => unknown;

export interface DefaultServerLifecycleServiceOptions {
  now?: () => Date;
  runtime?: ServerRuntime;
  system?: SystemRuntime;
  runCommand?: CommandRunner;
  schedule?: Scheduler;
}

const commandPathSuffix = ":/usr/local/bin:/opt/homebrew/bin";

function cpuSnapshot(cpus: ReturnType<typeof os.cpus>): CpuSnapshot {
  return cpus.reduce(
    (snapshot, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
      return { idle: snapshot.idle + cpu.times.idle, total: snapshot.total + total };
    },
    { idle: 0, total: 0 },
  );
}

export class DefaultServerLifecycleService implements ServerLifecycleService {
  private readonly now: () => Date;
  private readonly runtime: ServerRuntime;
  private readonly system: SystemRuntime;
  private previousCpu: CpuSnapshot;
  private readonly runCommand: CommandRunner;
  private readonly schedule: Scheduler;

  constructor(options: DefaultServerLifecycleServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.runtime = options.runtime ?? process;
    this.system = options.system ?? os;
    this.previousCpu = cpuSnapshot(this.system.cpus());
    this.runCommand = options.runCommand ?? runLifecycleCommand;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  }

  getHealth(_x: Context): ServerHealth {
    let revision: string | undefined;
    if (process.env.VITO_RELEASE_MODE === "1") {
      try {
        revision = /^Revision: ([a-f0-9]{40})$/m.exec(
          readFileSync(join(process.cwd(), "RELEASE_INFO"), "utf8"),
        )?.[1];
      } catch {
        /* source checkouts have no release marker */
      }
    }
    return { status: "ok", timestamp: this.now().toISOString(), ...(revision ? { revision } : {}) };
  }

  getStatus(_x: Context): ServerStatus {
    const currentCpu = cpuSnapshot(this.system.cpus());
    const totalDelta = currentCpu.total - this.previousCpu.total;
    const idleDelta = currentCpu.idle - this.previousCpu.idle;
    const cpuUsage =
      totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
    this.previousCpu = currentCpu;
    const memoryTotal = this.system.totalmem();
    const memoryFree = this.system.freemem();
    return {
      ...(process.env.VITO_RELEASE_MODE === "1" ? { managedRelease: true } : {}),
      uptime: this.runtime.uptime(),
      pid: this.runtime.pid,
      nodeVersion: this.runtime.version,
      memoryUsage: this.runtime.memoryUsage(),
      system: {
        cpuUsage,
        memoryTotal,
        memoryUsed: memoryTotal - memoryFree,
        memoryFree,
      },
    };
  }

  requestRestart(_x: Context, request: ServerRestartRequest): void {
    console.log(
      `[Dashboard] Server restart requested from ${request.clientIp} ua=${request.userAgent}`,
    );
    this.schedule(() => {
      void this.rebuildAndRestart();
    }, 500);
  }

  private async rebuildAndRestart(): Promise<void> {
    try {
      await this.runCommand({
        file: process.env.VITO_RELEASE_MODE === "1" ? "pm2" : "./scripts/restart-vito.sh",
        args: process.env.VITO_RELEASE_MODE === "1" ? ["restart", "vito-server"] : [],
        timeout: 900_000,
      });
    } catch (error: unknown) {
      console.error(
        "[Dashboard] Vito rebuild/restart failed; the current process is unchanged:",
        error,
      );
    }
  }
}

async function runLifecycleCommand(command: LifecycleCommand): Promise<void> {
  // The final PM2 restart kills this server. Run the rebuild in its own process
  // group so the parent disappearing cannot interrupt the build or misreport it.
  const logPath = join(process.cwd(), "user/logs/restart-vito.log");
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        timeout: command.timeout,
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ""}${commandPathSuffix}`,
        },
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    closeSync(logFd);
  }
}
