import "server-only";

import { NextResponse } from "next/server";

import { runTeamRosterSyncJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the team roster sync. Fetches the
 * configured Matticspace group's members and updates the auto-managed
 * block in JOB_CONTEXT.md's Common collaborators section.
 */
export async function POST() {
  const result = await runTeamRosterSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
