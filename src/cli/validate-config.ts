import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateVitoConfig } from "../shared/contracts/vito-config.js";

const configPath = resolve(process.argv[2] || "user/vito.config.json");

try {
  const raw = readFileSync(configPath, "utf-8");
  const value: unknown = JSON.parse(raw);
  const result = validateVitoConfig(value);

  if (!result.valid) {
    console.error(`Invalid Vito config: ${configPath}`);
    for (const issue of result.issues) {
      console.error(`- ${issue.path}: ${issue.message} (${issue.code})`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Valid Vito config: ${configPath}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to validate Vito config: ${configPath}`);
  console.error(`- <root>: ${message}`);
  process.exitCode = 1;
}
