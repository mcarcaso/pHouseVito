import type { Context } from "../../context/Context.js";
import type {
  ConfigValidationResult,
  CronJobConfig,
  VitoConfig,
} from "../../contracts/vito-config.js";

export interface VitoService {
  getConfig(x: Context): VitoConfig;
  saveConfig(x: Context, value: unknown): VitoConfig;
  validateConfig(x: Context, value: unknown): ConfigValidationResult;
  getSoul(x: Context): string;
  saveSoul(x: Context, soul: string): void;
  getSystemPrompt(x: Context): string;
  getConfiguredJobs(x: Context): CronJobConfig[];
}
