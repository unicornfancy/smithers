// Retry-with-backoff for flaky MCP calls (Layer A of the six-layer model).
//
// Defaults: 3 attempts at 1s / 4s / 16s. Tunable per call.

export interface RetryOptions {
  /** Maximum number of attempts including the first. Defaults to 3. */
  attempts?: number;
  /** Base delay in ms before the first retry. Defaults to 1000. */
  baseDelayMs?: number;
  /** Multiplier between successive retries. Defaults to 4. */
  factor?: number;
  /** Cap on any individual delay, in ms. Defaults to 30_000. */
  maxDelayMs?: number;
  /**
   * Predicate to decide whether an error is retryable. By default we retry
   * everything except `code === "auth"` (authentication errors won't recover
   * from a wait).
   */
  isRetryable?: (error: unknown) => boolean;
  /** Optional hook called before each sleep. Useful for logging/test. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULTS: Required<Omit<RetryOptions, "onRetry">> = {
  attempts: 3,
  baseDelayMs: 1000,
  factor: 4,
  maxDelayMs: 30_000,
  isRetryable: defaultIsRetryable,
};

function defaultIsRetryable(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "auth") return false;
  }
  return true;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
  /** True when the value came from a retry rather than the first attempt. */
  retried: boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const {
    attempts,
    baseDelayMs,
    factor,
    maxDelayMs,
    isRetryable,
  } = { ...DEFAULTS, ...options };

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await fn();
      return { value, attempts: attempt, retried: attempt > 1 };
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryable(err)) {
        throw err;
      }
      const delay = Math.min(
        baseDelayMs * Math.pow(factor, attempt - 1),
        maxDelayMs,
      );
      options.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  // Unreachable — the loop either returns or throws — but TS needs the throw.
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
