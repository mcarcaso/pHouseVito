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
  runCommand?: CommandRunner;
  schedule?: Scheduler;
}

const commandPathSuffix = ":/usr/local/bin:/opt/homebrew/bin";

export class DefaultServerLifecycleService implements ServerLifecycleService {
  private readonly now: () => Date;
  private readonly runtime: ServerRuntime;
  private readonly runCommand: CommandRunner;
  private readonly schedule: Scheduler;

  constructor(options: DefaultServerLifecycleServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.runtime = options.runtime ?? process;
    this.runCommand = options.runCommand ?? runLifecycleCommand;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  }

  getHealth(_x: Context): ServerHealth {
    return { status: "ok", timestamp: this.now().toISOString() };
  }

  getStatus(_x: Context): ServerStatus {
    return {
      uptime: this.runtime.uptime(),
      pid: this.runtime.pid,
      nodeVersion: this.runtime.version,
      memoryUsage: this.runtime.memoryUsage(),
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
