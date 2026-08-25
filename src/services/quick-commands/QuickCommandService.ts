import type { Context } from "../../context/Context.js";
import type { QuickCommandRow } from "../../stores/quick-commands/QuickCommandStore.js";

export interface QuickCommandService {
  submit(
    x: Context,
    input: {
      id: string;
      audioBase64: string;
      mimeType: string;
      durationMs: number;
      session?: string;
    },
  ): QuickCommandRow;
  get(x: Context, id: string): QuickCommandRow | null;
}
