import { NextResponse } from "next/server";

import { readQaRunReport } from "@/lib/server/kosh";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  const result = await readQaRunReport(runId);
  if (!result || !result.json) {
    return NextResponse.json(
      { error: "Report JSON not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(result.json, {
    headers: {
      "Content-Disposition": `inline; filename="qa-${runId}.json"`,
    },
  });
}
