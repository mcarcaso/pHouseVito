import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateVitoConfig } from "../shared/schemas/vito-config.js";

export interface ConfigValidationIssue {
  path: string;
  message: string;
  code: string;
}

export type ConfigValidationResult =
  | { valid: true; path: string }
  | { valid: false; path: string; issues: ConfigValidationIssue[] };

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
