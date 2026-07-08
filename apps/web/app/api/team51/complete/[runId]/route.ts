import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { completeTeam51Run } from "@/lib/server/team51";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Postback target for the Terminal-launched team51 CLI run script.
 *
 * The script curls here with `?token=<one-time>` and the full run
 * log as text/plain body plus `X-Exit-Code: <n>`. Smithers validates
 * the token (constant-time compare vs. the DB row's postback_token),
 * classifies success/failure from the exit code, parses the log for
 * structured results (new site URL), and stamps the row.
 *
 * The token is consumed on first successful validation — the row's
 * postback_token is set to NULL as part of the completion update,
 * so replays get 403. The endpoint accepts localhost-only via
 * Next's default binding; still, don't skip the token check.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  const token = request.nextUrl.searchParams.get("token");
  if (!runId || !token) {
    return NextResponse.json(
      { ok: false, reason: "missing-token-or-run" },
      { status: 400 },
    );
  }

  const exitHeader = request.headers.get("x-exit-code");
  const exitCode = exitHeader === null ? -1 : Number.parseInt(exitHeader, 10);
  if (!Number.isFinite(exitCode)) {
    return NextResponse.json(
      { ok: false, reason: "bad-exit-code" },
      { status: 400 },
    );
  }

  const logBody = await request.text();

  const result = await completeTeam51Run({
    runId,
    token,
    logBody,
    exitCode,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason ?? "invalid" },
      { status: result.reason === "bad-token" ? 403 : 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
