import "server-only";

import { getDb } from "./db";

/**
 * Stable agent identifier used as the namespace key for cache entries.
 * The set is closed deliberately so we don't accidentally fragment the
 * cache by agent-name typos.
 */
export type CachedAgent = "top-3" | "realistic-shape";

/**
 * Compose the cache key for a date-scoped agent run. The default — one
 * cache entry per agent per local date — is the right shape for the
 * morning-briefing trio: regenerate forces a fresh call, but a quiet
 * second tab open on the same day reads from cache.
 */
export function dateCacheKey(agent: CachedAgent, now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${agent}:${yyyy}-${mm}-${dd}`;
}

/**
 * Read a cached payload, returning the parsed JSON shape if and only
 * if the entry exists and hasn't expired. Returns null otherwise.
 *
 * Generic over T because each agent has its own response shape; the
 * caller asserts what comes out.
 */
export async function getCached<T>(
  agent: CachedAgent,
  cacheKey: string,
): Promise<T | null> {
  const db = await getDb();
  const row = db
    .prepare<[string, string], { payload: string; expires_at: string }>(
      `SELECT payload, expires_at FROM llm_cache
       WHERE cache_key = ? AND agent = ?`,
    )
    .get(cacheKey, agent);
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    // Lazy expiry: clear the row so we don't accumulate forever.
    db.prepare(`DELETE FROM llm_cache WHERE cache_key = ?`).run(cacheKey);
    return null;
  }
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    // Bad payload (shouldn't happen unless schema drift). Drop and miss.
    db.prepare(`DELETE FROM llm_cache WHERE cache_key = ?`).run(cacheKey);
    return null;
  }
}

/**
 * Write a payload to the cache, expiring at end-of-day in the local
 * timezone (i.e. midnight tomorrow). Caller can override via
 * `expiresAt` if a different TTL fits the agent.
 */
export async function setCached<T>(
  agent: CachedAgent,
  cacheKey: string,
  payload: T,
  expiresAt?: Date,
): Promise<void> {
  const db = await getDb();
  const expiry = (expiresAt ?? endOfDay(new Date())).toISOString();
  db.prepare(
    `INSERT INTO llm_cache(cache_key, agent, payload, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       expires_at = excluded.expires_at,
       created_at = datetime('now')`,
  ).run(cacheKey, agent, JSON.stringify(payload), expiry);
}

/** Drop all cached entries for an agent (e.g. after pin/demote). */
export async function clearCachedFor(agent: CachedAgent): Promise<void> {
  const db = await getDb();
  db.prepare(`DELETE FROM llm_cache WHERE agent = ?`).run(agent);
}

/** Drop a single cache entry by key. */
export async function clearCacheKey(cacheKey: string): Promise<void> {
  const db = await getDb();
  db.prepare(`DELETE FROM llm_cache WHERE cache_key = ?`).run(cacheKey);
}

function endOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(23, 59, 59, 999);
  return next;
}
