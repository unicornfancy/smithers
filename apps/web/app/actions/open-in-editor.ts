"use server";

import { openInEditor } from "@/lib/server/open-in-editor";

/**
 * Thin server-action wrapper around `openInEditor`. Lives in its own
 * file under `app/actions/` so any client component can import + call
 * it without dragging the larger actions barrels along.
 */
export async function openInEditorAction(
  path: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return openInEditor(path);
}
