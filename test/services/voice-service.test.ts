import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import type { AskApiOptions } from "../../src/shared/schemas/ask-api.js";
import type { AskApiService } from "../../src/services/ask/AskApiService.js";
import { DefaultVoiceService } from "../../src/services/voice/DefaultVoiceService.js";
import type { VoiceTaskRow, VoiceTaskStore } from "../../src/stores/voice/VoiceTaskStore.js";

class MemoryVoiceTaskStore implements VoiceTaskStore {
  readonly rows = new Map<string, VoiceTaskRow>();

  create(_x: ObjectContext, row: VoiceTaskRow): VoiceTaskRow {
    this.rows.set(row.id, row);
    return row;
  }

  get(_x: ObjectContext, id: string): VoiceTaskRow | null {
    return this.rows.get(id) ?? null;
  }

  listBySession(_x: ObjectContext, sessionId: string): VoiceTaskRow[] {
    return [...this.rows.values()].filter((row) => row.voice_session_id === sessionId);
  }

  update(
    _x: ObjectContext,
    id: string,
    changes: Partial<Pick<VoiceTaskRow, "status" | "result" | "error" | "updated_at">>,
  ): VoiceTaskRow {
    const current = this.rows.get(id);
    if (!current) throw new Error("Voice task not found");
    const updated = { ...current, ...changes };
    this.rows.set(id, updated);
    return updated;
  }
}

describe("DefaultVoiceService", () => {
  it("delegates each voice task to an independent investigator session", async () => {
    const store = new MemoryVoiceTaskStore();
    const asks: AskApiOptions[] = [];
    const resolvers: Array<(result: string) => void> = [];
    const askApiService: AskApiService = {
      configure: () => undefined,
      isConfigured: () => true,
      ask: async (_x, options) => {
        asks.push(options);
        return await new Promise<string>((resolve) => resolvers.push(resolve));
      },
    };
    const x = new ObjectContext({ voiceTaskStore: () => store });
    const service = new DefaultVoiceService(askApiService);

    const first = service.askAsync(x, "voice:123", "First task");
    const second = service.askAsync(x, "voice:123", "Second task");

    assert.equal(asks.length, 2);
    assert.equal(asks[0]?.session, `voice-investigator:${first.id}`);
    assert.equal(asks[1]?.session, `voice-investigator:${second.id}`);
    assert.notEqual(asks[0]?.session, asks[1]?.session);
    assert.equal(store.get(x, first.id)?.status, "running");
    assert.equal(store.get(x, second.id)?.status, "running");

    resolvers[0]?.("First result");
    resolvers[1]?.("Second result");
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(store.get(x, first.id)?.result, "First result");
    assert.equal(store.get(x, second.id)?.result, "Second result");
  });
});
