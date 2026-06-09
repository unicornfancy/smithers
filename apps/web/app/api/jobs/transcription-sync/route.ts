import "server-only";

import { NextResponse } from "next/server";

import { runTranscriptionSyncJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the transcription-sync job. Warms the
 * configured provider's recordings cache so /calls and /today's Recent
 * Calls panel show new meetings without an explicit fetch.
 *
 * The legacy `/api/jobs/fathom-sync` endpoint forwards here for
 * compatibility with already-installed crontabs / launchd plists.
 */
export async function POST() {
  const result = await runTranscriptionSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
