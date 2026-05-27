import "server-only";

import { NextResponse } from "next/server";

import { runFathomSyncJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the Fathom sync job. Warms the
 * recordings cache so /calls and /today's Recent Calls panel show
 * new meetings without an explicit fetch.
 */
export async function POST() {
  const result = await runFathomSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
