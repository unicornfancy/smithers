import { createHash, randomUUID } from "node:crypto";

/** New random v4 UUID; used for project_id and draft_id. */
export function newId(): string {
  return randomUUID();
}

/**
 * Deterministic hash-derived id, used for follow-up rows and other things
 * we read out of free-form markdown without explicit ids. Stable across reads
 * as long as the inputs don't change.
 */
export function deterministicId(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(p);
    h.update("\x1f");
  }
  return h.digest("hex").slice(0, 32);
}
