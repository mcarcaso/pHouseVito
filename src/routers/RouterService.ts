import type { Router } from "express";
import type { Context } from "../context/Context.js";

/** HTTP transport boundary implemented by each focused server router. */
export interface RouterService {
  createRouter(x: Context): Promise<Router>;
}
