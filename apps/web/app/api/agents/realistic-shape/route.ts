import "server-only";

import { NextResponse } from "next/server";

import {
  composeRealisticShape,
  type RealisticShapeOutput,
} from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import {
  dateCacheKey,
  getCached,
  setCached,
} from "@/lib/server/llm-cache";
import { getMcpClient } from "@/lib/server/mcp";
import { detectStalls } from "@/lib/server/stalls";
import {
  buildTopThreeCandidates,
  pickRulesBasedTop3,
} from "@/lib/server/top-three";
import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface RealisticShapeResponse {
  ok: boolean;
  output?: RealisticShapeOutput;
  usage?: { input_tokens: number; output_tokens: number };
  /** True when served from cache, false on fresh agent call. */
  cached?: boolean;
  error?: string;
  error_kind?: "missing_api_key" | "agent_failed";
}

interface CachedPayload {
  output: RealisticShapeOutput;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const runtime = await getAgentRuntime();
  if (!runtime) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "missing_api_key",
        error:
          "ANTHROPIC_API_KEY not set. Add it to apps/web/.env.local and restart pnpm dev.",
      } satisfies RealisticShapeResponse,
      { status: 412 },
    );
  }

  const cacheKey = dateCacheKey("realistic-shape");
  if (!force) {
    const cached = await getCached<CachedPayload>("realistic-shape", cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        output: cached.output,
        usage: cached.usage,
        cached: true,
      } satisfies RealisticShapeResponse);
    }
  }

  const vault = await getVault();
  const mcp = await getMcpClient();

  const [pingsResult, stalls, candidates, followUps, styleGuide] =
    await Promise.all([
      mcp.contextA8C.listPings({ limit: 10 }),
      detectStalls({ vault }),
      mcp.contextA8C
        .listPings({ limit: 10 })
        .then((p) =>
          buildTopThreeCandidates({
            vault,
            pings: p.ok ? p.data : (p.cachedData ?? []),
          }),
        ),
      vault.listFollowUps().catch(() => ({ active: [], resolved: [] })),
      vault.readStyleGuide().catch(() => null),
    ]);

  const pings = pingsResult.ok
    ? pingsResult.data
    : (pingsResult.cachedData ?? []);
  const top3 = pickRulesBasedTop3(candidates);
  const concentratedProject = pickConcentratedProject(top3, stalls.items, pings);

  try {
    const result = await composeRealisticShape(runtime, {
      dayOfWeek: dayOfWeek(),
      timeOfDay: timeOfDay(),
      top3Titles: top3.map((c) => c.task),
      stallCounts: {
        force_decide: stalls.counts.force_decide,
        escalate: stalls.counts.escalate,
        nudge: stalls.counts.nudge,
      },
      pingCount: pings.length,
      followUpCount: followUps.active.length,
      concentratedProject,
      style: styleGuide?.body
        ? { label: "Katie's writing style", body: styleGuide.body }
        : undefined,
    });

    const payload: CachedPayload = {
      output: result.output,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
    };
    await setCached("realistic-shape", cacheKey, payload);
    return NextResponse.json({
      ok: true,
      ...payload,
      cached: false,
    } satisfies RealisticShapeResponse);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "agent_failed",
        error: err instanceof Error ? err.message : String(err),
      } satisfies RealisticShapeResponse,
      { status: 502 },
    );
  }
}

/**
 * Find the project name that appears most across Top 3 + stalls + pings.
 * Returns undefined when no project owns more than half the signal.
 */
function pickConcentratedProject(
  top3: ReadonlyArray<{ project_name?: string }>,
  stalls: ReadonlyArray<{ project_name?: string; context: string }>,
  pings: ReadonlyArray<{ project_match?: { project_slug: string } | null }>,
): string | undefined {
  const counts = new Map<string, number>();
  const bump = (name: string | undefined) => {
    if (!name) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  for (const t of top3) bump(t.project_name);
  for (const s of stalls) bump(s.project_name);
  for (const p of pings) bump(p.project_match?.project_slug);
  let topName: string | undefined;
  let topCount = 0;
  let total = 0;
  for (const [name, n] of counts) {
    total += n;
    if (n > topCount) {
      topCount = n;
      topName = name;
    }
  }
  if (!topName) return undefined;
  return topCount / total >= 0.5 ? topName : undefined;
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
