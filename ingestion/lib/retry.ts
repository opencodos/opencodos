/**
 * Generic retry with exponential backoff and jitter.
 * Extracted from Granola's summarize-calls.ts pattern.
 */

interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  label?: string;
  onRetry?: (attempt: number, error: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 * Delay formula: baseDelay * 2^(attempt-2) + random(0..1000)ms
 *
 * @param fn - Async function to retry
 * @param opts - Retry options
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelay = opts?.baseDelay ?? 5000;
  const label = opts?.label ?? "retry";
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        const delay = baseDelay * Math.pow(2, attempt - 2) + Math.floor(Math.random() * 1000);
        await sleep(delay);
      }
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        if (opts?.onRetry) {
          opts.onRetry(attempt, err);
        }
        console.warn(
          `[${label}] Attempt ${attempt}/${maxAttempts} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  throw lastError;
}
