// In-memory stale-while-revalidate cache.
//
// This is the "L1" cache for MCP results. Backed by a plain Map for now — a
// SQLite-backed L2 cache (for survival across server restarts and the
// "ContextA8C is down, render last-known good" degraded mode) lands with the
// `contexta8c_resilience` slice.

interface CacheEntry<T> {
  value: T;
  /** Wall-clock ms when the entry was stored. */
  fetchedAt: number;
  /** Wall-clock ms after which the entry is no longer fresh. */
  freshUntil: number;
  /** Wall-clock ms after which the entry is no longer servable. */
  staleUntil: number;
}

export interface SwrTtl {
  /** How long the value is treated as fresh (cache hit, no revalidation). */
  freshMs: number;
  /**
   * Additional grace period during which the cached value is returned while a
   * background refresh kicks off. Default 10× freshMs.
   */
  staleMs?: number;
}

export interface SwrResult<T> {
  value: T;
  from: "fresh" | "cache" | "stale";
  fetchedAt: string;
}

export class SwrCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * Stale-while-revalidate read.
   *
   * - within `freshMs`: return cache, no fetch
   * - within `freshMs + staleMs`: return cache, kick off background refresh
   * - else: fetch and return
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: SwrTtl,
  ): Promise<SwrResult<T>> {
    const now = Date.now();
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    const staleMs = ttl.staleMs ?? ttl.freshMs * 10;

    if (entry && now < entry.freshUntil) {
      return {
        value: entry.value,
        from: "cache",
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
      };
    }

    if (entry && now < entry.staleUntil) {
      void this.refreshInBackground(key, fetcher, ttl);
      return {
        value: entry.value,
        from: "stale",
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
      };
    }

    const value = await this.refreshInBackground(key, fetcher, ttl);
    return {
      value,
      from: "fresh",
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Force-fetch, ignoring any cached entry. */
  async refresh<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: SwrTtl,
  ): Promise<SwrResult<T>> {
    const value = await this.refreshInBackground(key, fetcher, ttl);
    return {
      value,
      from: "fresh",
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Read the last-known cached value without revalidating. */
  peek<T>(key: string): SwrResult<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    const now = Date.now();
    return {
      value: entry.value,
      from: now < entry.freshUntil ? "cache" : "stale",
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
    };
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  private async refreshInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: SwrTtl,
  ): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const staleMs = ttl.staleMs ?? ttl.freshMs * 10;
    const promise = fetcher()
      .then((value) => {
        const now = Date.now();
        this.store.set(key, {
          value,
          fetchedAt: now,
          freshUntil: now + ttl.freshMs,
          staleUntil: now + ttl.freshMs + staleMs,
        });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }
}
