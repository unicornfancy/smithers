import "server-only";

import { NextResponse } from "next/server";

import {
  detectTeam51,
  probeExternalTools,
  type ExternalTool,
} from "@/lib/server/team51";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Runs the external-tool probes team51 workflows depend on. Backs
 * the Diagnostics "Test external tools" card so the user can debug
 * auth state without waiting for a real command to blow up.
 *
 * `?tools=op,gh` narrows the probe set; default probes all three
 * (op + gh + ssh). Also reports whether the team51 binary itself
 * is resolvable, since that's the primary integration prerequisite.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const toolsParam = url.searchParams.get("tools");
  const tools: ExternalTool[] = toolsParam
    ? (toolsParam
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is ExternalTool =>
          s === "op" || s === "gh" || s === "ssh",
        ) as ExternalTool[])
    : ["op", "gh", "ssh"];

  const [detect, probes] = await Promise.all([
    detectTeam51(),
    probeExternalTools(tools),
  ]);

  return NextResponse.json({
    ok: true,
    team51: detect,
    tools: probes,
  });
}
