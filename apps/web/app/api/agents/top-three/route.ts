import "server-only";

import { NextResponse } from "next/server";

import { composeTopThree, type TopThreeOutput } from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import { getMcpClient } from "@/lib/server/mcp";
import {
  buildTopThreeCandidates,
  type TopThreeCandidate,
} from "@/lib/server/top-three";
import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface TopThreeResponse {
  ok: boolean;
  output?: TopThreeOutput;
  /** Echoed back so the UI can render score breakdowns next to the LLM's picks. */
  candidates?: TopThreeCandidate[];
  reasoning?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
  error_kind?: "missing_api_key" | "no_candidates" | "agent_failed";
}

const TOP_N_TO_LLM = 8;

export async function POST() {
  const runtime = await getAgentRuntime();
  if (!runtime) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "missing_api_key",
        error:
          "ANTHROPIC_API_KEY not set. Add it to .env.local at the repo root.",
      } satisfies TopThreeResponse,
      { status: 412 },
    );
  }

  const vault = await getVault();
  const mcp = await getMcpClient();
  const pingsResult = await mcp.contextA8C.listPings({ limit: 10 });
  const pings = pingsResult.ok
    ? pingsResult.data
    : (pingsResult.cachedData ?? []);

  const candidates = await buildTopThreeCandidates({ vault, pings });

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "no_candidates",
        error:
          "No candidates found. Add some open tasks to a project, follow-ups, or pings first.",
      } satisfies TopThreeResponse,
      { status: 404 },
    );
  }

  const top = candidates.slice(0, TOP_N_TO_LLM);
  const styleGuide = await vault.readStyleGuide().catch(() => null);

  try {
    const result = await composeTopThree(runtime, {
      candidates: top.map((c) => ({
        candidate_id: c.candidate_id,
        source: c.source,
        task: c.task,
        context: c.context,
        project_name: c.project_name,
        project_status: c.project_status,
        score: c.score,
        score_breakdown: c.score_breakdown,
      })),
      timeOfDay: timeOfDay(),
      dayOfWeek: dayOfWeek(),
      candidateCount: candidates.length,
      style: styleGuide?.body
        ? { label: "Katie's writing style", body: styleGuide.body }
        : undefined,
    });

    return NextResponse.json({
      ok: true,
      output: result.output,
      candidates: top,
      reasoning: result.reasoning,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
    } satisfies TopThreeResponse);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "agent_failed",
        error: err instanceof Error ? err.message : String(err),
      } satisfies TopThreeResponse,
      { status: 502 },
    );
  }
}

function timeOfDay(): "morning" | "midday" | "afternoon" {
  const h = new Date().getHours();
  if (h < 11) return "morning";
  if (h < 14) return "midday";
  return "afternoon";
}

function dayOfWeek(): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  return names[new Date().getDay()]!;
}
