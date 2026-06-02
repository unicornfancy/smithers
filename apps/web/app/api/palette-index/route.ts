import { NextResponse } from "next/server";

import { getPaletteIndex } from "@/lib/server/palette-index";

export const dynamic = "force-dynamic";

/**
 * Serves the Ask Smithers palette index. Client fetches once on first
 * open per session, then re-uses. Server keeps a 5-min in-memory cache
 * so mashing Cmd-K doesn't re-hit MCP.
 *
 * `?force=1` bypasses the server cache (used by future "refresh" UI).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  try {
    const index = await getPaletteIndex({ force });
    return NextResponse.json(index, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "palette-index failed",
      },
      { status: 500 },
    );
  }
}
