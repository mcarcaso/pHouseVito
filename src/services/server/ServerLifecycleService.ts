import type { Context } from "../../context/Context.js";

export interface ServerHealth {
  status: "ok";
  timestamp: string;
}

export interface ServerStatus {
  uptime: number;
  pid: number;
  nodeVersion: string;
  memoryUsage: NodeJS.MemoryUsage;
  system: {
    cpuUsage: number;
    memoryTotal: number;
    memoryUsed: number;
    memoryFree: number;
  };
}

export interface ServerRestartRequest {
  clientIp?: string;
  userAgent: string;
}

export interface ServerLifecycleService {
  getHealth(x: Context): ServerHealth;
  getStatus(x: Context): ServerStatus;
  requestRestart(x: Context, request: ServerRestartRequest): void;
}
