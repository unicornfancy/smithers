import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database, { type Database as DB } from "better-sqlite3";

import { loadConfig } from "./config";

const SCHEMA_VERSION = 3;

let cached: DB | null = null;
let cachedPath: string | null = null;

/**
 * Lazily-opened SQLite handle. better-sqlite3 is synchronous, so all the
 * helpers built on top of this are sync too — no async/await ceremony for
 * what's effectively local state.
 *
 * The DB lives at `<paths.data>/state.db` (default `~/.smithers/state.db`).
 * The directory is created on first use; the schema is migrated forward
 * via `applyMigrations` as new versions land.
 *
 * SQLite is *cache + UI state* — the markdown vault is the source of
 * truth. Anything stored here should be reproducible from vault data.
 */
export async function getDb(): Promise<DB> {
  const cfg = await loadConfig();
  const dbPath = join(cfg.paths.data, "state.db");

  if (cached && cachedPath === dbPath) {
    // Re-check migrations on every call. The handle is long-lived
    // (often multi-day in `pnpm dev`), but new code may add migrations
    // the cached connection hasn't seen yet. Each call is a single
    // SELECT against `meta` plus the matching CREATE TABLE IF NOT
    // EXISTS — cheap, and avoids a "no such table" error after pulling
    // a schema bump without a server restart.
    applyMigrations(cached);
    return cached;
  }
  if (cached) {
    // Path changed (config swap mid-runtime) — close the old handle.
    cached.close();
    cached = null;
  }

  mkdirSync(cfg.paths.data, { recursive: true });
  const db = new Database(dbPath);
  // Recommended pragmas for a small embedded app.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  applyMigrations(db);

  cached = db;
  cachedPath = dbPath;
  return db;
}

function applyMigrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const row = db
    .prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")
    .get();
  const current = row ? Number(row.value) : 0;

  if (current < 1) migrationV1(db);
  if (current < 2) migrationV2(db);
  if (current < 3) migrationV3(db);
  // Future migrations land here as `if (current < 4) migrationV4(db); ...`

  db.prepare(
    "INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(SCHEMA_VERSION));
}

function migrationV1(db: DB): void {
  // Single table for all per-entity user actions: dismiss, pin, accept,
  // etc. Keeping them together means we don't fragment the schema as new
  // action types land.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_actions (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT,
      PRIMARY KEY (entity_type, entity_id, action)
    );
    CREATE INDEX IF NOT EXISTS idx_user_actions_lookup
      ON user_actions(entity_type, action);
  `);
}

function migrationV2(db: DB): void {
  // Cache for LLM agent outputs. Keys look like "top-3:2026-04-29" or
  // "realistic-shape:2026-04-29". Payload is the full JSON-serialized
  // agent response. Cleared explicitly on pin/demote (handled in
  // server actions); also expires by wall-clock at end-of-day.
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      cache_key TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_cache_agent
      ON llm_cache(agent);
  `);
}

function migrationV3(db: DB): void {
  // Per-ping "did Katie already reply" verdict cache. Populated by an
  // explicit Refresh action on /today's Pings panel — not on every page
  // load — so the per-source MCP fanout cost is paid on demand only.
  // `actioned=true` greys the ping out in the UI.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ping_actioned (
      ping_id TEXT PRIMARY KEY,
      actioned INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
