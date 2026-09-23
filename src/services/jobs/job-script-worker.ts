import { pathToFileURL } from "node:url";

interface StartMessage {
  type: "start";
  path: string;
  data: Record<string, unknown>;
}
interface ReplyMessage {
  type: "reply";
  id: number;
  value?: unknown;
  error?: string;
}

const controller = new AbortController();
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextCallId = 0;
let started = false;

function abort(): void {
  controller.abort();
  for (const waiter of pending.values()) waiter.reject(new Error("Job script cancelled"));
  pending.clear();
  setTimeout(() => process.exit(1), 1_000).unref();
}

process.on("disconnect", abort);
process.on("SIGTERM", abort);
process.on("SIGINT", abort);
process.on("message", async (message: StartMessage | ReplyMessage | { type: "abort" }) => {
  if (message.type === "abort") {
    abort();
    return;
  }
  if (message.type === "reply") {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.value);
    return;
  }
  if (message.type !== "start" || started) return;
  started = true;

  const call = (method: "prompt" | "generate", input: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      controller.signal.throwIfAborted();
      const id = nextCallId++;
      pending.set(id, { resolve, reject });
      process.send?.({ type: "call", id, method, input });
    });

  try {
    const moduleUrl = `${pathToFileURL(message.path).href}?run=${encodeURIComponent(String(message.data.runId))}`;
    const loaded = (await import(moduleUrl)) as { default?: unknown };
    if (typeof loaded.default !== "function") {
      throw new Error("Job script must default-export a function");
    }
    const result = await loaded.default({
      ...message.data,
      signal: controller.signal,
      prompt: (input: unknown) => call("prompt", input),
      generate: (input: unknown) => call("generate", input),
    });
    controller.signal.throwIfAborted();
    if (pending.size > 0)
      throw new Error("Await all job.prompt and job.generate calls before returning");
    process.send?.({ type: "result", value: result ?? null }, () => process.exit(0));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job script failed";
    console.error(error instanceof Error ? error.stack : message);
    process.send?.({ type: "failure", error: message }, () => process.exit(1));
  }
});
