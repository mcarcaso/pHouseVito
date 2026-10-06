import type { Transformer } from "grammy";
type TelegramSignal = Parameters<Transformer>[3];

/** Bound retries, respect Telegram cooldowns, and allow shutdown/cancellation. */
export function telegramRateLimitRetry(
  wait: (ms: number, signal?: TelegramSignal) => Promise<void> = (ms, signal) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new Error("Telegram retry aborted"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    }),
): Transformer {
  return async (previous, method, payload, signal) => {
    for (let attempt = 0; ; attempt++) {
      const response = await previous(method, payload, signal);
      if (response.ok || response.error_code !== 429 || attempt >= 3) return response;
      const seconds = response.parameters?.retry_after;
      if (!seconds || !Number.isFinite(seconds) || seconds > 120) return response;
      await wait(seconds * 1000, signal);
    }
  };
}
