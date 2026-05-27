import "server-only";

import { NextResponse } from "next/server";

import { runPingMonitorJob } from "@/lib/server/scheduler-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual + scheduled trigger for the Ping Monitor job. Re-runs the
 * "did Katie reply?" detector against the current Pings to Action
 * feed and writes verdicts to the ping_actioned cache.
 *
 * Same path-shape as the daily-briefing endpoint: usable by the
 * in-process cron, by the optional launchd plist, and by the
 * "Run now" button on /settings.
 */
export async function POST() {
  const result = await runPingMonitorJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return POST();
}
