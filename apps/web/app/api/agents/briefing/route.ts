import "server-only";

import { NextResponse } from "next/server";

import { runDailyBriefing } from "@/lib/server/briefing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual or scheduled trigger for the daily briefing pre-warm.
 *
 * - Used by the in-process cron (registered in `instrumentation.ts`)
 * - Used by the optional launchd plist
 * - Can be triggered by curl for testing: `curl -X POST http://localhost:3000/api/agents/briefing`
 *
 * Idempotent — uses the same caches as /today so running it multiple
 * times the same day either no-ops (without `?force=true`) or replaces
 * the cached output (with).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") !== "false";
  const result = await runDailyBriefing({ force });
  const ok = result.top_three.ok && result.realistic_shape.ok;
  return NextResponse.json(result, { status: ok ? 200 : 207 });
}

export async function GET(req: Request) {
  return POST(req);
}
