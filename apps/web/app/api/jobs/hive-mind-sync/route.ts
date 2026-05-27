import "server-only";

import { NextResponse } from "next/server";

import { runHiveMindSyncJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the Hive Mind sync job. Runs
 * `git pull --ff-only` against the configured Hive Mind clone so
 * collaborative edits from other TAMs land without manual git work.
 * Skips on a dirty working tree to avoid fighting conflicts.
 */
export async function POST() {
  const result = await runHiveMindSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
