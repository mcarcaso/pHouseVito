import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { SqliteAppPreferenceStore } from "../../src/stores/app-preferences/SqliteAppPreferenceStore.js";

function setup() {
  const db = createDatabase(":memory:");
  const x = new ObjectContext({ db: () => db });
  return { db, x, store: new SqliteAppPreferenceStore() };
}

test("app preferences merge independently by preference group", () => {
  const { db, x, store } = setup();
  store.patch(x, "owner", { speech: { provider: "openai", voice: "alloy", rate: 1 } }, 10);
  const record = store.patch(
    x,
    "owner",
    {
      voiceMode: {
        provider: "auto",
        model: "gpt-realtime-mini",
        openaiVoice: "marin",
        geminiVoice: "Kore",
      },
    },
    20,
  );

  assert.equal(record.preferences.speech?.voice, "alloy");
  assert.equal(record.preferences.voiceMode?.geminiVoice, "Kore");
  assert.equal(record.updatedAt, 20);
  assert.deepEqual(store.get(x, "missing"), null);
  db.close();
});
