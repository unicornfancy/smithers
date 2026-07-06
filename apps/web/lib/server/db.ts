import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database, { type Database as DB } from "better-sqlite3";

import { loadConfig } from "./config";

const SCHEMA_VERSION = 4;

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
  if (current < 4) migrationV4(db);
  // Future migrations land here as `if (current < 5) migrationV5(db); ...`

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

function migrationV4(db: DB): void {
  // Kosh QA runs. One row per `claude --plugin-dir kosh -p "/kosh:<type> <url>"`
  // launch. Status walks queued → running → completed | failed | cancelled.
  // `pid` is recorded so the server can attempt SIGTERM on cancel, but a
  // stale pid is harmless (we never reuse a row's pid after the process exits).
  // `report_json_relpath` and `report_md_relpath` are relative to the Hive
  // Mind clone root (under the partner/project) so the detail page can
  // resolve them via the configured hiveMindPath.
  db.exec(`
    CREATE TABLE IF NOT EXISTS qa_runs (
      id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      test_type TEXT NOT NULL,
      target_url TEXT NOT NULL,
      env TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      pid INTEGER,
      log_path TEXT,
      report_json_relpath TEXT,
      report_md_relpath TEXT,
      report_html_relpath TEXT,
      counts_critical INTEGER,
      counts_high INTEGER,
      counts_medium INTEGER,
      counts_low INTEGER,
      error_message TEXT,
      source TEXT NOT NULL DEFAULT 'cli'
    );
    CREATE INDEX IF NOT EXISTS idx_qa_runs_project
      ON qa_runs(project_slug, started_at DESC);
  `);

  // Additive migration for existing DBs — Kosh v2 emits HTML reports
  // instead of MD, so we track the HTML path alongside the legacy MD
  // path (both stay readable so historical MD runs still render).
  const cols = db
    .prepare(`PRAGMA table_info(qa_runs)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "report_html_relpath")) {
    db.exec(`ALTER TABLE qa_runs ADD COLUMN report_html_relpath TEXT;`);
  }
}
