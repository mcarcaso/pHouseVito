import type { Context } from "../../context/Context.js";

export interface AppProcessStatus {
  name: string;
  status: string;
  uptime: number | null;
  restarts: number;
  memory: number | null;
}

export type AppProcessAction = "start" | "stop" | "restart" | "delete";

export interface AppProcessService {
  list(x: Context, appNames?: string[]): Promise<AppProcessStatus[]>;
  execute(x: Context, args: { action: AppProcessAction; appName: string }): Promise<void>;
}
