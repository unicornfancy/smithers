import "server-only";

import { NextResponse } from "next/server";

import { runTeamCharterSyncJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the team charter sync. Pulls the
 * configured Google Sheet tab via the Drive API and updates the
 * auto-managed block in `my-voice/TEAM_CHARTER.md`.
 */
export async function POST() {
  const result = await runTeamCharterSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
