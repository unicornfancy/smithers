// Per-source isolation (Layer B of the six-layer model).
//
// One slow/failing source must never block the others. `runIsolated` wraps a
// fetcher with: SWR cache → retry-with-backoff → health bookkeeping → typed
// SourceResult. Every public mcp-client method should funnel through here.

import type { SwrCache, SwrTtl } from "./cache";
import type { HealthRegistry } from "./health";
import type { RetryOptions } from "./retry";
import { withRetry } from "./retry";
import type { McpError, McpSourceId, SourceResult } from "./types";

export interface IsolationContext {
  cache: SwrCache;
  health: HealthRegistry;
}

export interface RunIsolatedOptions<T> {
  source: McpSourceId;
  /** Cache key. Should fully describe the call's inputs. */
  cacheKey: string;
  ttl: SwrTtl;
  retry?: RetryOptions;
  fetcher: () => Promise<T>;
}

export async function runIsolated<T>(
  ctx: IsolationContext,
  opts: RunIsolatedOptions<T>,
): Promise<SourceResult<T>> {
  let attemptedRetry = false;
  try {
    const swr = await ctx.cache.get(
      opts.cacheKey,
      async () => {
        const outcome = await withRetry(opts.fetcher, opts.retry);
        attemptedRetry = outcome.retried;
        return outcome.value;
      },
      opts.ttl,
    );
    ctx.health.recordSuccess(opts.source);
    return {
      ok: true,
      data: swr.value,
      from: swr.from,
      fetched_at: swr.fetchedAt,
    };
  } catch (err) {
    const error: McpError = toMcpError(err, opts.source, attemptedRetry);
    ctx.health.recordFailure(opts.source, error);
    const cached = ctx.cache.peek<T>(opts.cacheKey);
    if (cached) {
      return {
        ok: false,
        error,
        cachedData: cached.value,
        fetched_at: cached.fetchedAt,
      };
    }
    return { ok: false, error };
  }
}

function toMcpError(
  err: unknown,
  source: McpSourceId,
  retried: boolean,
): McpError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const e = err as { code?: unknown; message?: unknown; cause?: unknown };
    return {
      code: typeof e.code === "string" ? e.code : "unknown",
      message: typeof e.message === "string" ? e.message : String(err),
      cause: typeof e.cause === "string" ? e.cause : undefined,
      source,
      retried,
      at: new Date().toISOString(),
    };
  }
  return {
    code: "unknown",
    message: err instanceof Error ? err.message : String(err),
    source,
    retried,
    at: new Date().toISOString(),
  };
}

export class McpClientError extends Error {
  override readonly name = "McpClientError";
  constructor(
    public readonly code: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}
