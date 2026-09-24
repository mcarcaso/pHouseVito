import { fork } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "../../context/Context.js";
import { xLogsDir } from "../../lib/x.js";

export interface JobScriptCall {
  method: "prompt" | "generate";
  input: unknown;
}

export class JobScriptRunner {
  async run(
    x: Context,
    args: {
      path: string;
      data: Record<string, unknown>;
      jobName: string;
      signal: AbortSignal;
      call: (call: JobScriptCall) => Promise<unknown>;
    },
  ): Promise<unknown> {
    const workerFile = import.meta.url.endsWith(".ts")
      ? "./job-script-worker.ts"
      : "./job-script-worker.js";
    const workerPath = fileURLToPath(new URL(workerFile, import.meta.url));
    const logPath = join(xLogsDir(x), "jobs", `${args.jobName}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const log = (stream: "stdout" | "stderr", text: string) => {
      appendFileSync(logPath, `${new Date().toISOString()} ${stream} ${text}`);
    };

    return await new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let resultReceived = false;
      let abortError: Error | undefined;
      const child = fork(workerPath, [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: process.env,
      });
      child.stdout?.on("data", (chunk: Buffer) => log("stdout", chunk.toString("utf-8")));
      child.stderr?.on("data", (chunk: Buffer) => log("stderr", chunk.toString("utf-8")));

      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        args.signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => {
        abortError = new Error("Job cancelled");
        child.send({ type: "abort" });
        setTimeout(() => child.kill("SIGKILL"), 1_500).unref();
      };
      args.signal.addEventListener("abort", abort, { once: true });
      if (args.signal.aborted) {
        abort();
        return;
      }

      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object" || !("type" in message)) return;
        if (message.type === "result" && "value" in message) {
          if (abortError) return;
          resultReceived = true;
          finish(undefined, message.value);
          return;
        }
        if (message.type === "failure" && "error" in message && typeof message.error === "string") {
          finish(new Error(message.error));
          return;
        }
        if (
          message.type !== "call" ||
          !("id" in message) ||
          typeof message.id !== "number" ||
          !("method" in message) ||
          (message.method !== "prompt" && message.method !== "generate") ||
          !("input" in message)
        )
          return;
        void args
          .call({ method: message.method, input: message.input })
          .then((value) => child.send({ type: "reply", id: message.id, value }))
          .catch((error) =>
            child.send({
              type: "reply",
              id: message.id,
              error: error instanceof Error ? error.message : "Job call failed",
            }),
          );
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (settled) return;
        if (abortError) {
          finish(abortError);
          return;
        }
        if (!resultReceived) {
          finish(new Error(`Job worker exited before returning (code=${code}, signal=${signal})`));
        }
      });
      child.send({ type: "start", path: args.path, data: args.data });
    });
  }
}
