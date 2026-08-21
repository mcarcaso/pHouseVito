import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateVitoConfig } from "../shared/schemas/vito-config.js";

export interface ConfigValidationIssue {
  path: string;
  message: string;
  code: string;
}

export type ConfigValidationResult =
  { valid: true; path: string } | { valid: false; path: string; issues: ConfigValidationIssue[] };

export function validateConfigFile(path: string): ConfigValidationResult {
  const resolvedPath = resolve(path);
  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    const value: unknown = JSON.parse(raw);
    const result = validateVitoConfig(value);
    if (result.valid) return { valid: true, path: resolvedPath };
    return { valid: false, path: resolvedPath, issues: result.issues };
  } catch (error) {
    return {
      valid: false,
      path: resolvedPath,
      issues: [
        {
          path: "<root>",
          message: error instanceof Error ? error.message : String(error),
          code: "read_error",
        },
      ],
    };
  }
}

export type ConfigMigrationResult =
  | { valid: true; path: string; changed: boolean }
  | { valid: false; path: string; issues: ConfigValidationIssue[] };

export function migrateConfigFile(path: string): ConfigMigrationResult {
  const resolvedPath = resolve(path);
  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    const value: unknown = JSON.parse(raw);
    const result = validateVitoConfig(value);
    if (!result.valid) {
      return { valid: false, path: resolvedPath, issues: result.issues };
    }

    const canonical = `${JSON.stringify(result.config, null, 2)}\n`;
    if (canonical === raw) return { valid: true, path: resolvedPath, changed: false };

    const temporaryPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, canonical, "utf-8");
      renameSync(temporaryPath, resolvedPath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
    return { valid: true, path: resolvedPath, changed: true };
  } catch (error) {
    return {
      valid: false,
      path: resolvedPath,
      issues: [
        {
          path: "<root>",
          message: error instanceof Error ? error.message : String(error),
          code: "migration_error",
        },
      ],
    };
  }
}

export function printConfigValidation(result: ConfigValidationResult): void {
  if (result.valid) {
    console.log(`Valid Vito config: ${result.path}`);
    return;
  }
  console.error(`Invalid Vito config: ${result.path}`);
  for (const issue of result.issues) {
    console.error(`- ${issue.path}: ${issue.message} (${issue.code})`);
  }
}

export function printConfigMigration(result: ConfigMigrationResult): void {
  if (result.valid) {
    console.log(
      result.changed
        ? `Migrated Vito config: ${result.path}`
        : `Vito config is already current: ${result.path}`,
    );
    return;
  }
  console.error(`Unable to migrate Vito config: ${result.path}`);
  for (const issue of result.issues) {
    console.error(`- ${issue.path}: ${issue.message} (${issue.code})`);
  }
}
