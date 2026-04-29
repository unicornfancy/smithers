import "server-only";

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database, { type Database as DB } from "better-sqlite3";

import { loadConfig } from "./config";

const SCHEMA_VERSION = 1;

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

  if (cached && cachedPath === dbPath) return cached;
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
  // Future migrations land here as `if (current < 2) migrationV2(db); ...`

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
