import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { DefaultFactService } from "../../src/services/facts/DefaultFactService.js";
import type {
  ExtractedFactCandidate,
  FactExtractionInput,
  FactExtractor,
} from "../../src/services/facts/FactExtractor.js";
import { createEmbeddingDatabase } from "../../src/stores/embeddings/embedding-database.js";
import { SqliteFactStore } from "../../src/stores/facts/SqliteFactStore.js";
import { SqliteMessageStore } from "../../src/stores/messages/SqliteMessageStore.js";

class QueuedFactExtractor implements FactExtractor {
  readonly version = "test-v1";
  readonly outputs: ExtractedFactCandidate[][] = [];
  readonly inputs: FactExtractionInput[] = [];
  delayMs = 0;
  active = 0;
  maxActive = 0;

  async extract(_x: unknown, input: FactExtractionInput): Promise<ExtractedFactCandidate[]> {
    this.inputs.push(input);
    const output = this.outputs.shift() ?? [];
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.active -= 1;
    return output;
  }
}

function candidate(args: {
  text: string;
  value: string;
  messageId: number;
  quote: string;
}): ExtractedFactCandidate {
  return {
    canonicalText: args.text,
    kind: "preference",
    slotKey: "mike.preference.color",
    canonicalValue: args.value,
    status: "active",
    validFrom: null,
    validTo: null,
    entities: ["Mike"],
    sources: [{ messageId: args.messageId, quote: args.quote }],
  };
}

function setup() {
  const db = createDatabase(":memory:");
  const embeddingDb = createEmbeddingDatabase(":memory:");
  const extractor = new QueuedFactExtractor();
  const store = new SqliteFactStore();
  const messageStore = new SqliteMessageStore();
  const service = new DefaultFactService();
  db.prepare(
    `INSERT INTO sessions (id, channel, channel_target, created_at, last_active_at)
     VALUES ('test:session', 'test', 'session', 1, 1)`,
  ).run();
  const x = new ObjectContext({
    db: () => db,
    userDir: () => "/tmp/vito-fact-service-test",
    embeddingDb: () => embeddingDb,
    embeddingService: () => ({
      create: async () => new Float32Array([1, 0]),
      createMany: async (_context: unknown, texts: string[]) =>
        texts.map(() => new Float32Array([1, 0])),
    }),
    factExtractor: () => extractor,
    factStore: () => store,
    factService: () => service,
    messageStore: () => messageStore,
  });
  let chunkIndex = 0;
  const addUserMessage = (text: string, timestamp: number) => {
    const message = messageStore.create(x, {
      session_id: "test:session",
      channel: "test",
      channel_target: "session",
      timestamp,
      type: "user",
      content: JSON.stringify(text),
      archived: 0,
      author: "Mike",
    });
    embeddingDb
      .prepare(
        `INSERT INTO chunks
         (session_id, day, chunk_index, text, context, embedded_text,
          msg_id_start, msg_id_end, msg_count)
         VALUES (?, '1970-01-01', ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        "test:session",
        chunkIndex++,
        text,
        "Preference discussion.",
        `Preference discussion.\n\n${text}`,
        message.id,
        message.id,
      );
    return message;
  };
  return { db, embeddingDb, extractor, store, service, x, addUserMessage };
}

describe("atomic fact ingestion", () => {
  it("extracts and reconciles historical chunks one at a time in chronological order", async () => {
    const fixture = setup();
    try {
      const first = fixture.addUserMessage("I prefer red.", 1_000);
      const second = fixture.addUserMessage("I now prefer blue.", 2_000);
      fixture.extractor.outputs.push(
        [
          candidate({
            text: "Mike prefers red.",
            value: "red",
            messageId: first.id,
            quote: "I prefer red.",
          }),
        ],
        [
          candidate({
            text: "Mike prefers blue.",
            value: "blue",
            messageId: second.id,
            quote: "I now prefer blue.",
          }),
        ],
      );

      const firstResult = await fixture.service.backfill(fixture.x);
      assert.equal(firstResult.batchesProcessed, 1);
      assert.equal(fixture.store.list(fixture.x, { order: "oldest" })[0]?.status, "active");

      const secondResult = await fixture.service.backfill(fixture.x);
      assert.equal(secondResult.batchesProcessed, 1);
      const facts = fixture.store.list(fixture.x, { order: "oldest" });
      assert.equal(facts[0]?.status, "superseded");
      assert.equal(facts[1]?.status, "active");
      assert.equal(fixture.extractor.maxActive, 1);
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });

  it("processes one live chunk per ingestion pass", async () => {
    const fixture = setup();
    try {
      fixture.addUserMessage("First live chunk.", 1_000);
      fixture.addUserMessage("Second live chunk.", 2_000);
      fixture.extractor.outputs.push([], []);

      const first = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(first.batchesProcessed, 1);
      assert.equal(fixture.extractor.inputs.length, 1);

      const second = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(second.batchesProcessed, 1);
      assert.equal(fixture.extractor.inputs.length, 2);
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });

  it("excludes thoughts and raw tool events from model extraction", async () => {
    const fixture = setup();
    try {
      fixture.addUserMessage("Remember my preference.", 1_000);
      const messageStore = new SqliteMessageStore();
      let lastMessageId = 0;
      for (const [type, content, timestamp] of [
        ["thought", "private reasoning", 1_100],
        ["tool_start", { toolName: "read", args: {} }, 1_200],
        ["tool_end", { toolName: "read", result: "very large raw result" }, 1_300],
        ["assistant", "I'll remember it.", 1_400],
      ] as const) {
        const created = messageStore.create(fixture.x, {
          session_id: "test:session",
          channel: "test",
          channel_target: "session",
          timestamp,
          type,
          content: JSON.stringify(content),
          archived: 0,
          author: type === "assistant" ? "Vito" : null,
        });
        lastMessageId = created.id;
      }
      fixture.embeddingDb
        .prepare("UPDATE chunks SET msg_id_end = ?, msg_count = 5 WHERE chunk_index = 0")
        .run(lastMessageId);

      await fixture.service.ingestNew(fixture.x, "test:session");
      assert.deepEqual(
        fixture.extractor.inputs[0].messages.map((message) => message.type),
        ["user", "assistant"],
      );
      assert.equal(
        fixture.extractor.inputs[0].messages.some((message) => message.text.includes("raw result")),
        false,
      );
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });

  it("adds evidence to deterministic duplicates and supersedes a changed slot", async () => {
    const fixture = setup();
    try {
      const firstMessage = fixture.addUserMessage("I prefer blue.", 1_000);
      fixture.extractor.outputs.push([
        candidate({
          text: "Mike prefers blue.",
          value: "blue",
          messageId: firstMessage.id,
          quote: "I prefer blue.",
        }),
      ]);
      const first = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(first.inserted.length, 1);

      const secondMessage = fixture.addUserMessage("Blue is still my preference.", 2_000);
      fixture.extractor.outputs.push([
        candidate({
          text: "Mike prefers blue.",
          value: "blue",
          messageId: secondMessage.id,
          quote: "Blue is still my preference.",
        }),
      ]);
      const second = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.deepEqual(second.supported, first.inserted);
      const supported = fixture.store.list(fixture.x, { ids: first.inserted });
      assert.equal(supported[0].sources.length, 2);

      const thirdMessage = fixture.addUserMessage("I prefer green now.", 3_000);
      fixture.extractor.outputs.push([
        candidate({
          text: "Mike now prefers green.",
          value: "green",
          messageId: thirdMessage.id,
          quote: "I prefer green now.",
        }),
      ]);
      const third = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(third.inserted.length, 1);
      assert.deepEqual(third.superseded, first.inserted);
      assert.equal(fixture.store.list(fixture.x, { ids: first.inserted })[0].status, "superseded");
      const current = fixture.store.list(fixture.x, { ids: third.inserted })[0];
      assert.equal(current.supersedesFactId, first.inserted[0]);
      assert.equal(current.status, "active");

      const fourthMessage = fixture.addUserMessage("I switched back to blue.", 4_000);
      fixture.extractor.outputs.push([
        candidate({
          text: "Mike now prefers blue again.",
          value: "blue",
          messageId: fourthMessage.id,
          quote: "I switched back to blue.",
        }),
      ]);
      const fourth = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(fourth.inserted.length, 1);
      assert.deepEqual(fourth.superseded, third.inserted);
      const returned = fixture.store.list(fixture.x, { ids: fourth.inserted })[0];
      assert.equal(returned.canonicalValue, "blue");
      assert.equal(returned.supersedesFactId, third.inserted[0]);
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });

  it("rejects model output whose evidence quote is not in the raw message", async () => {
    const fixture = setup();
    try {
      const message = fixture.addUserMessage("I prefer blue.", 1_000);
      fixture.extractor.outputs.push([
        candidate({
          text: "Mike prefers red.",
          value: "red",
          messageId: message.id,
          quote: "I prefer red.",
        }),
      ]);
      const result = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(result.inserted.length, 0);
      assert.equal(result.rejected.length, 1);
      assert.match(result.rejected[0].reason, /exact substring/);
      assert.equal(fixture.store.count(fixture.x, {}), 0);
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });

  it("rejects credential values even when model output cites them exactly", async () => {
    const fixture = setup();
    try {
      const text = "My API key: sk-this-is-a-fake-credential-value-12345";
      const message = fixture.addUserMessage(text, 1_000);
      fixture.extractor.outputs.push([
        {
          ...candidate({
            text: "Mike's API key is sk-this-is-a-fake-credential-value-12345.",
            value: "sk-this-is-a-fake-credential-value-12345",
            messageId: message.id,
            quote: text,
          }),
          kind: "state",
          slotKey: "mike.credential.openai",
        },
      ]);
      const result = await fixture.service.ingestNew(fixture.x, "test:session");
      assert.equal(result.inserted.length, 0);
      assert.match(result.rejected[0].reason, /credential-like/);
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });

  it("retrieves facts with their exact evidence", async () => {
    const fixture = setup();
    try {
      const message = fixture.addUserMessage("I prefer blue.", 1_000);
      fixture.extractor.outputs.push([
        candidate({
          text: "Mike prefers blue.",
          value: "blue",
          messageId: message.id,
          quote: "I prefer blue.",
        }),
      ]);
      await fixture.service.ingestNew(fixture.x, "test:session");
      const results = await fixture.service.search(fixture.x, "Mike blue preference", {
        currentOnly: true,
      });
      assert.equal(results[0].fact.canonicalText, "Mike prefers blue.");
      assert.equal(results[0].fact.sources[0].quote, "I prefer blue.");
    } finally {
      fixture.db.close();
      fixture.embeddingDb.close();
    }
  });
});
