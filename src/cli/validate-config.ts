import { resolve } from "node:path";
import {
  printConfigValidation,
  validateConfigFile,
} from "./config-validation.js";

const configPath = resolve(process.argv[2] || "user/vito.config.json");
const result = validateConfigFile(configPath);
printConfigValidation(result);
if (!result.valid) process.exitCode = 1;
