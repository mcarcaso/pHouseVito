import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Context } from "../../context/Context.js";
import {
  type ConfigValidationIssue,
  type ConfigValidationResult,
  type CronJobConfig,
  type VitoConfig,
  validateVitoConfig,
} from "../../shared/contracts/vito-config.js";
import { xProjectDir, xUserDir } from "../../lib/x.js";
import type { VitoService } from "./VitoService.js";

export class VitoConfigValidationError extends Error {
  constructor(
    readonly configPath: string,
    readonly issues: ConfigValidationIssue[]
  ) {
    super(
      `Invalid Vito config at ${configPath}:\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`
    );
    this.name = "VitoConfigValidationError";
  }
}

export class FileVitoService implements VitoService {
  private cachedConfig?: VitoConfig;
  private configMtimeMs?: number;
  private reportedInvalidMtimeMs?: number;

  getConfig(x: Context): VitoConfig {
    const configPath = this.getConfigPath(x);
    const mtimeMs = this.getMtimeMs(configPath);
    if (this.cachedConfig && mtimeMs === this.configMtimeMs) {
      return structuredClone(this.cachedConfig);
    }

    try {
      const raw = readFileSync(configPath, "utf-8");
      const value: unknown = JSON.parse(raw);
      const result = validateVitoConfig(value);
      if (!result.valid) {
        return this.handleInvalidConfig(configPath, mtimeMs, result.issues);
      }

      this.cachedConfig = result.config;
      this.configMtimeMs = mtimeMs;
      this.reportedInvalidMtimeMs = undefined;
      return structuredClone(result.config);
    } catch (error) {
      if (error instanceof VitoConfigValidationError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return this.handleInvalidConfig(configPath, mtimeMs, [
        { path: "<root>", message, code: "invalid_json" },
      ]);
    }
  }

  saveConfig(x: Context, value: unknown): VitoConfig {
    const configPath = this.getConfigPath(x);
    const result = validateVitoConfig(value);
    if (!result.valid) {
      throw new VitoConfigValidationError(configPath, result.issues);
    }

    this.writeAtomic(configPath, `${JSON.stringify(result.config, null, 2)}\n`);
    this.cachedConfig = result.config;
    this.configMtimeMs = this.getMtimeMs(configPath);
    this.reportedInvalidMtimeMs = undefined;
    return structuredClone(result.config);
  }

  validateConfig(_x: Context, value: unknown): ConfigValidationResult {
    return validateVitoConfig(value);
  }

  getSoul(x: Context): string {
    const soulPath = this.getSoulPath(x);
    if (!existsSync(soulPath)) return "";
    return readFileSync(soulPath, "utf-8");
  }

  saveSoul(x: Context, soul: string): void {
    this.writeAtomic(this.getSoulPath(x), soul);
  }

  getSystemPrompt(x: Context): string {
    const systemPromptPath = join(xProjectDir(x), "system", "SYSTEM.md");
    if (!existsSync(systemPromptPath)) return "";
    return readFileSync(systemPromptPath, "utf-8");
  }

  getConfiguredJobs(x: Context): CronJobConfig[] {
    return this.getConfig(x).cron.jobs;
  }

  private handleInvalidConfig(
    configPath: string,
    mtimeMs: number,
    issues: ConfigValidationIssue[]
  ): VitoConfig {
    if (!this.cachedConfig) {
      throw new VitoConfigValidationError(configPath, issues);
    }

    if (this.reportedInvalidMtimeMs !== mtimeMs) {
      console.error(
        `[Config] Invalid update ignored; continuing with last known valid config:\n${issues
          .map((issue) => `- ${issue.path}: ${issue.message}`)
          .join("\n")}`
      );
      this.reportedInvalidMtimeMs = mtimeMs;
    }
    return structuredClone(this.cachedConfig);
  }

  private getConfigPath(x: Context): string {
    return join(xUserDir(x), "vito.config.json");
  }

  private getSoulPath(x: Context): string {
    return join(xUserDir(x), "SOUL.md");
  }

  private getMtimeMs(path: string): number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return -1;
    }
  }

  private writeAtomic(path: string, content: string): void {
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, content, "utf-8");
      renameSync(temporaryPath, path);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
}
