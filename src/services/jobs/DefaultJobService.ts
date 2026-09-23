import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import {
  xChannelRegistryService,
  xJobRunStore,
  xOrchestratorService,
  xPiAuthPath,
  xVitoService,
} from "../../lib/x.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";
import type { ScriptJobConfig } from "../../shared/schemas/vito-config.js";
import { JobScriptRunner, type JobScriptCall } from "./JobScriptRunner.js";
import type { JobResult, JobRun, JobService } from "./JobService.js";

const promptInputSchema = z
  .object({ session: z.string().min(1), message: z.string().min(1) })
  .strict();
const generateInputSchema = z
  .object({
    prompt: z.string().min(1),
    model: z.object({ provider: z.string().min(1), name: z.string().min(1) }).optional(),
    maxTokens: z.number().int().min(1).max(32_000).optional(),
    reasoning: z.enum(["minimal", "low", "medium", "high"]).optional(),
  })
  .strict();
const resultSchema = z
  .union([
    z.string(),
    z
      .object({
        text: z.string(),
        files: z.array(z.string()).optional(),
      })
      .strict(),
  ])
  .nullable();

function responseText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

export class DefaultJobService implements JobService {
  private readonly active = new Map<string, AbortController>();
  private modelRuntime?: Promise<ModelRuntime>;

  constructor(private readonly runner = new JobScriptRunner()) {}

  recover(x: Context): void {
    const count = xJobRunStore(x).recoverInterrupted(x);
    if (count > 0) console.warn(`[Jobs] Marked ${count} interrupted or uncertain run(s)`);
  }

  async execute(
    x: Context,
    job: ScriptJobConfig,
    scheduledAt: string,
  ): Promise<JobRun | undefined> {
    const store = xJobRunStore(x);
    const run = store.claim(x, job, scheduledAt, new Date().toISOString());
    if (!run) return undefined;
    const controller = new AbortController();
    this.active.set(run.id, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, job.timeoutMs);
    const cancellationPoll = setInterval(() => {
      if (store.read(x, run.id)?.cancelled === true) controller.abort();
    }, 250);
    cancellationPoll.unref();

    try {
      if (!isAbsolute(job.script) || !job.script.endsWith(".ts")) {
        throw new Error(`Job ${job.name} script must be an absolute .ts file`);
      }
      if (!existsSync(job.script) || !statSync(job.script).isFile()) {
        throw new Error(`Job ${job.name} script does not exist: ${job.script}`);
      }
      const value = await this.runner.run(x, {
        path: job.script,
        jobName: job.name,
        signal: controller.signal,
        data: {
          id: job.name,
          name: job.name,
          runId: run.id,
          scheduledAt,
          session: job.session,
        },
        call: async (call) => await this.handleCall(x, run, call, controller.signal),
      });
      controller.signal.throwIfAborted();
      const parsed = resultSchema.parse(value);
      if (parsed === null) {
        run.state = "skipped";
      } else {
        const result: JobResult = typeof parsed === "string" ? { text: parsed } : parsed;
        for (const path of result.files ?? []) {
          if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isFile()) {
            throw new Error(`Job returned a missing or non-absolute file: ${path}`);
          }
        }
        run.result = result;
        run.state = "completed";
        run.delivery = job.delivery ? "pending" : "none";
      }
    } catch (error) {
      const latest = store.read(x, run.id);
      const cancelled = latest?.cancelled === true;
      run.cancelled = cancelled;
      run.state = cancelled ? "cancelled" : "failed";
      run.error = timedOut
        ? `Job timed out after ${job.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "Job failed";
      run.delivery = "none";
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
      this.active.delete(run.id);
      run.finishedAt = new Date().toISOString();
      store.save(x, run);
    }

    if (run.state === "completed" && run.delivery === "pending") {
      await this.deliver(x, run);
    }
    return run;
  }

  cancel(x: Context, runId: string): boolean {
    const cancelled = xJobRunStore(x).cancel(x, runId);
    if (cancelled) this.active.get(runId)?.abort();
    return cancelled;
  }

  runs(x: Context, query?: { name?: string; limit?: number }): JobRun[] {
    return xJobRunStore(x).list(x, query);
  }

  private async handleCall(
    x: Context,
    run: JobRun,
    call: JobScriptCall,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (call.method === "prompt") {
      const input = promptInputSchema.parse(call.input);
      xJobRunStore(x).addPrompt(x, run.id, input.session);
      run.promptSessions.push(input.session);
      return {
        text: await xOrchestratorService(x).prompt(x, {
          session: input.session,
          message: `[Scheduled job: ${run.job.name}; run: ${run.id}; scheduled for ${run.scheduledAt}. This is scheduled work, not a new message typed by the user.]\n${input.message}`,
          signal,
        }),
        session: input.session,
      };
    }

    const input = generateInputSchema.parse(call.input);
    this.modelRuntime ??= ModelRuntime.create({ authPath: xPiAuthPath(x), refreshOnCreate: false });
    const runtime = await this.modelRuntime;
    const configured = xVitoService(x).getConfig(x).settings["pi-coding-agent"]?.model;
    const modelConfig = input.model ?? configured;
    if (!modelConfig) throw new Error("No model is configured for job.generate");
    const model = runtime.getModel(modelConfig.provider, modelConfig.name);
    if (!model)
      throw new Error(`Unknown generation model: ${modelConfig.provider}/${modelConfig.name}`);
    signal.throwIfAborted();
    const response = await runtime.completeSimple(
      model,
      { messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }] },
      {
        maxTokens: input.maxTokens ?? 2_000,
        reasoning: input.reasoning ?? "minimal",
        signal,
      },
    );
    signal.throwIfAborted();
    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Stateless generation failed");
    }
    return responseText(response.content);
  }

  private async deliver(x: Context, run: JobRun): Promise<void> {
    const destination = run.job.delivery;
    if (!destination || !run.result) return;
    const registration = xChannelRegistryService(x).get(x, destination.channel);
    if (!registration) {
      run.delivery = "failed";
      run.error = `Delivery channel is not configured: ${destination.channel}`;
      xJobRunStore(x).save(x, run);
      return;
    }

    run.delivery = "delivering";
    xJobRunStore(x).save(x, run);
    const event: InboundEvent = {
      sessionKey: `${destination.channel}:${destination.target}`,
      channel: destination.channel,
      target: destination.target,
      author: "scheduled-job",
      timestamp: Date.now(),
      content: "",
      hasMention: true,
      raw: { synthetic: true, source: "scheduled-job-delivery", deliveryKey: `job:${run.id}` },
    };
    try {
      const handler = registration.channel.createOutputHandler(registration.x, event);
      const files = (run.result.files ?? []).map((path) => `MEDIA:${path}`).join("\n");
      await handler.relay([run.result.text, files].filter(Boolean).join("\n"));
      await handler.endMessage?.();
      run.delivery = "delivered";
      run.error = null;
    } catch (error) {
      run.delivery = "failed";
      run.error = error instanceof Error ? error.message : "Delivery failed";
    }
    xJobRunStore(x).save(x, run);
  }
}
