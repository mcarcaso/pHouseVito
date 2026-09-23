export interface JobContext {
  id: string;
  name: string;
  runId: string;
  scheduledAt: string;
  session?: string;
  signal: AbortSignal;
  prompt(input: { session: string; message: string }): Promise<{ text: string; session: string }>;
  generate(input: {
    prompt: string;
    model?: { provider: string; name: string };
    maxTokens?: number;
    reasoning?: "minimal" | "low" | "medium" | "high";
  }): Promise<string>;
}

export type JobOutput = string | { text: string; files?: string[] } | undefined;
export type JobScript = (job: JobContext) => Promise<JobOutput>;
