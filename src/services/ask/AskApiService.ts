import type { Context } from "../../context/Context.js";
import type { AskApiOptions } from "../../shared/contracts/ask-api.js";

export type AskApiHandler = (options: AskApiOptions) => Promise<string>;

export class AskHandlerNotConfiguredError extends Error {
  constructor() {
    super("Ask handler not configured");
    this.name = "AskHandlerNotConfiguredError";
  }
}

export interface AskApiService {
  configure(x: Context, handler: AskApiHandler): void;
  isConfigured(x: Context): boolean;
  ask(x: Context, options: AskApiOptions): Promise<string>;
}
