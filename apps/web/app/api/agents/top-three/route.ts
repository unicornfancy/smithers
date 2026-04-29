import "server-only";

import { NextResponse } from "next/server";

import { composeTopThree, type TopThreeOutput } from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import { writeTopThreeToDailyNote } from "@/lib/server/daily-note-writeback";
import {
  dateCacheKey,
  getCached,
  setCached,
} from "@/lib/server/llm-cache";
import { getMcpClient } from "@/lib/server/mcp";
import {
  applyTop3UserActions,
  buildTopThreeCandidates,
  type TopThreeCandidate,
} from "@/lib/server/top-three";
import {
  listEntityIdsWithAction,
  localMidnight,
} from "@/lib/server/user-actions";
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
  /** True when served from the day's cache, false on fresh agent call. */
  cached?: boolean;
  error?: string;
  error_kind?: "missing_api_key" | "no_candidates" | "agent_failed";
}

interface CachedPayload {
  output: TopThreeOutput;
  candidates: TopThreeCandidate[];
  reasoning?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

const TOP_N_TO_LLM = 8;

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
      } satisfies TopThreeResponse,
      { status: 412 },
    );
  }

  // Cache hit: serve the day's existing picks unless the caller forced
  // a regenerate. Clearing happens on pin/demote and end-of-day expiry.
  const cacheKey = dateCacheKey("top-3");
  if (!force) {
    const cached = await getCached<CachedPayload>("top-3", cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        output: cached.output,
        candidates: cached.candidates,
        reasoning: cached.reasoning,
        usage: cached.usage,
        cached: true,
      } satisfies TopThreeResponse);
    }
  }

  const vault = await getVault();
  const mcp = await getMcpClient();
  const pingsResult = await mcp.contextA8C.listPings({ limit: 10 });
  const pings = pingsResult.ok
    ? pingsResult.data
    : (pingsResult.cachedData ?? []);

  // Pins/demotes are today-scoped — see /today/page.tsx for the same.
  const since = localMidnight();
  const [pinnedIds, demotedIds] = await Promise.all([
    listEntityIdsWithAction("top3_candidate", "pin", since),
    listEntityIdsWithAction("top3_candidate", "demote", since),
  ]);
  const rawCandidates = await buildTopThreeCandidates({ vault, pings });
  const candidates = applyTop3UserActions(
    rawCandidates,
    pinnedIds,
    demotedIds,
  );

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

  // applyTop3UserActions has already pushed pinned items to the top via
  // a sentinel score boost, so the natural slice grabs them. Belt-and-
  // suspenders: union with the explicit pin set in case top-N is < the
  // number of pins (unlikely but guards against silent loss).
  const topByScore = candidates.slice(0, TOP_N_TO_LLM);
  const top = ensurePinnedIncluded(topByScore, candidates, pinnedIds);
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
      pinnedIds: Array.from(pinnedIds),
      style: styleGuide?.body
        ? { label: "Katie's writing style", body: styleGuide.body }
        : undefined,
    });

    const payload: CachedPayload = {
      output: result.output,
      candidates: top,
      reasoning: result.reasoning,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
    };
    await setCached("top-3", cacheKey, payload);
    // Side-effect: persist the picks to today's daily note so the vault
    // keeps a permanent journal entry. Errors are logged but don't
    // affect the response.
    await writeTopThreeToDailyNote(result.output);
    return NextResponse.json({
      ok: true,
      ...payload,
      cached: false,
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

/**
 * Ensure every pinned candidate is in the slice we send to the LLM.
 * applyTop3UserActions already boosts pinned candidates' scores so they
 * sort to the top, but we hedge against future changes to that ordering
 * by explicitly unioning the pinned set.
 */
function ensurePinnedIncluded(
  topByScore: TopThreeCandidate[],
  all: TopThreeCandidate[],
  pinnedIds: ReadonlySet<string>,
): TopThreeCandidate[] {
  if (pinnedIds.size === 0) return topByScore;
  const present = new Set(topByScore.map((c) => c.candidate_id));
  const missing = all.filter(
    (c) => pinnedIds.has(c.candidate_id) && !present.has(c.candidate_id),
  );
  if (missing.length === 0) return topByScore;
  return [...missing, ...topByScore];
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
