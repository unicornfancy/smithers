import "server-only";

import { NextResponse } from "next/server";

import { getMatticspaceHandleMap } from "@/lib/server/matticspace-roster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serializable Matticspace handle map for client-side @-mention
 * verification. Backed by the MCP client's 1h SWR cache so calls
 * within an hour are essentially free.
 *
 * Used by HandleCheckBanner in /weekly-updates/[isoWeek] and
 * AiDraftDialog to flag draft text mentions that don't match a
 * known wp_username.
 */
export async function GET() {
  try {
    const map = await getMatticspaceHandleMap();
    return NextResponse.json(map, {
      // Browser shouldn't cache aggressively — fresh from the server's
      // SWR-cached MCP call is fine, but stale-from-client could
      // mismatch reality after a team-roster sync.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        known_wp_usernames: [],
        by_candidate: {},
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
