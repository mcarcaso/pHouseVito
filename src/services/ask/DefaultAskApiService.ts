import type { Context } from "../../context/Context.js";
import type { AskApiOptions } from "../../contracts/ask-api.js";
import {
  AskHandlerNotConfiguredError,
  type AskApiHandler,
  type AskApiService,
} from "./AskApiService.js";

export class DefaultAskApiService implements AskApiService {
  private handler?: AskApiHandler;

  configure(_x: Context, handler: AskApiHandler): void {
    this.handler = handler;
  }

  isConfigured(_x: Context): boolean {
    return this.handler !== undefined;
  }

  async ask(_x: Context, options: AskApiOptions): Promise<string> {
    if (!this.handler) throw new AskHandlerNotConfiguredError();
    return await this.handler(options);
  }
}
