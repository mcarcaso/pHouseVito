import os from "node:os";
import { execa } from "execa";
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
    return { status: "ok", timestamp: this.now().toISOString() };
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
        file: "./scripts/restart-vito.sh",
        args: [],
        timeout: 300_000,
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
  await execa(command.file, command.args, {
    stdio: "pipe",
    timeout: command.timeout,
    env: {
      ...process.env,
      PATH: `${process.env.PATH ?? ""}${commandPathSuffix}`,
    },
  });
}
