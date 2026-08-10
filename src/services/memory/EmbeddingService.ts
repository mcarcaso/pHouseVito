import type { Context } from "../../context/Context.js";

export interface EmbeddingService {
  create(x: Context, text: string): Promise<Float32Array>;
}
