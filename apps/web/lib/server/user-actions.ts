import "server-only";

import { getDb } from "./db";

/**
 * Entity types we track user actions against. Keeping these as a string
 * union (not a free-form string) means typos surface at compile time.
 */
export type EntityType =
  | "ping"
  | "stall"
  | "top3_candidate"
  | "follow_up";

export type ActionKind = "dismiss" | "pin" | "accept" | "demote";

export interface UserActionRow {
  entity_type: EntityType;
  entity_id: string;
  action: ActionKind;
  created_at: string;
  reason: string | null;
}

/**
 * Record an action against an entity. Idempotent — calling dismiss twice
 * for the same id is a no-op (the existing row's created_at stays put,
 * which is what you want for "Katie saw this on Monday and chose not to
 * act" breadcrumb semantics).
 */
export async function recordAction(
  entityType: EntityType,
  entityId: string,
  action: ActionKind,
  reason?: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO user_actions(entity_type, entity_id, action, reason)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id, action) DO NOTHING`,
  ).run(entityType, entityId, action, reason ?? null);
}

/** Remove a previously-recorded action. Returns true if a row was deleted. */
export async function clearAction(
  entityType: EntityType,
  entityId: string,
  action: ActionKind,
): Promise<boolean> {
  const db = await getDb();
  const result = db
    .prepare(
      `DELETE FROM user_actions
       WHERE entity_type = ? AND entity_id = ? AND action = ?`,
    )
    .run(entityType, entityId, action);
  return result.changes > 0;
}

/** Return the set of entity ids with a given action recorded. */
export async function listEntityIdsWithAction(
  entityType: EntityType,
  action: ActionKind,
): Promise<Set<string>> {
  const db = await getDb();
  const rows = db
    .prepare<[EntityType, ActionKind], { entity_id: string }>(
      `SELECT entity_id FROM user_actions
       WHERE entity_type = ? AND action = ?`,
    )
    .all(entityType, action);
  return new Set(rows.map((r) => r.entity_id));
}

/** Has this entity been subject to this action? */
export async function hasAction(
  entityType: EntityType,
  entityId: string,
  action: ActionKind,
): Promise<boolean> {
  const db = await getDb();
  const row = db
    .prepare<[EntityType, string, ActionKind], { count: number }>(
      `SELECT COUNT(*) AS count FROM user_actions
       WHERE entity_type = ? AND entity_id = ? AND action = ?`,
    )
    .get(entityType, entityId, action);
  return (row?.count ?? 0) > 0;
}

// --- Convenience helpers (the dismiss/pin pair we'll use first) ---------

export async function dismiss(
  entityType: EntityType,
  entityId: string,
  reason?: string,
): Promise<void> {
  return recordAction(entityType, entityId, "dismiss", reason);
}

export async function undismiss(
  entityType: EntityType,
  entityId: string,
): Promise<boolean> {
  return clearAction(entityType, entityId, "dismiss");
}

export async function listDismissedIds(
  entityType: EntityType,
): Promise<Set<string>> {
  return listEntityIdsWithAction(entityType, "dismiss");
}

/**
 * Read every recorded user action, newest first. Used by /settings'
 * Activity Log to give the user an audit trail + undo affordance.
 *
 * No pagination — the data set is small (one row per user click) and
 * we want a single render pass for the table. Add limit if it ever
 * grows past a few hundred rows.
 */
export async function listAllActions(): Promise<UserActionRow[]> {
  const db = await getDb();
  const rows = db
    .prepare<[], UserActionRow>(
      `SELECT entity_type, entity_id, action, created_at, reason
       FROM user_actions
       ORDER BY created_at DESC`,
    )
    .all();
  return rows;
}
