import "server-only";

import { NextResponse } from "next/server";

import { runZendeskStatusSyncJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the Zendesk status sync. Re-polls
 * Zendesk for every attached ticket across all partner/team projects
 * and writes fresh status/subject/priority/updated_at into project
 * frontmatter — so /today's "Waiting on you" card doesn't surface
 * tickets that have since been closed by someone else.
 */
export async function POST() {
  const result = await runZendeskStatusSyncJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
