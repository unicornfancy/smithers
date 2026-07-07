import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database, { type Database as DB } from "better-sqlite3";

import { loadConfig } from "./config";

const SCHEMA_VERSION = 6;

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
  if (current < 5) migrationV5(db);
  if (current < 6) migrationV6(db);
  // Future migrations land here as `if (current < 7) migrationV7(db); ...`

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
}

/**
 * Additive columns on `qa_runs` for Kosh v2 (HTML reports + structured
 * failure classification). Sat inside migrationV4 originally, which
 * only fires on fresh installs (schema_version < 4) — existing V4
 * DBs never picked the columns up, so `failure_kind` was always
 * missing and gate-detection couldn't persist. Bumped the schema
 * version to 5 and moved the ALTERs here so pre-existing installs
 * finally get the columns on next restart.
 *
 *   report_html_relpath — Kosh v2 emits HTML reports instead of MD;
 *     we track the HTML path alongside the legacy MD path so
 *     historical MD runs still render.
 *   failure_kind — structured failure classification (e.g. "gated:
 *     coming-soon", "unknown-command:aeo") so the detail page can
 *     render a specialized recovery card. Free-text error_message
 *     stays untouched.
 *
 * Guarded by PRAGMA table_info so a fresh install (where the columns
 * are already in the CREATE TABLE) is a no-op.
 */
function migrationV5(db: DB): void {
  const cols = db
    .prepare(`PRAGMA table_info(qa_runs)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "report_html_relpath")) {
    db.exec(`ALTER TABLE qa_runs ADD COLUMN report_html_relpath TEXT;`);
  }
  if (!cols.some((c) => c.name === "failure_kind")) {
    db.exec(`ALTER TABLE qa_runs ADD COLUMN failure_kind TEXT;`);
  }
}

/**
 * `team51_runs` — one row per team51-cli invocation. Mirrors the
 * `qa_runs` shape (project_slug, target-descriptor, status, log_path,
 * pid, timings, structured failure_kind). We stash the resolved
 * argv as JSON in `args_json` so retries and detail pages can render
 * exactly what was passed; the CLI's stdout/stderr live in the log
 * file at `log_path`, not the DB.
 *
 * `command` is the Symfony command slug (e.g. `wpcom:create-site`);
 * `command_group` groups related commands (`wpcom` / `pressable` /
 * `deployhq` / `github`) so a workbench card can filter by group.
 * `result_json` holds parsed post-run structured data — e.g. the new
 * site URL from a create-site run — so we can write back to
 * frontmatter without re-parsing stdout every time.
 */
function migrationV6(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team51_runs (
      id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      command TEXT NOT NULL,
      command_group TEXT NOT NULL,
      args_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      pid INTEGER,
      exit_code INTEGER,
      log_path TEXT,
      failure_kind TEXT,
      error_message TEXT,
      result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_team51_runs_project
      ON team51_runs(project_slug, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_team51_runs_status
      ON team51_runs(status);
  `);
}
