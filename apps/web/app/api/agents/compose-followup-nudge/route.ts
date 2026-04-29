import "server-only";

import { NextResponse } from "next/server";

import {
  composeFollowUpNudge,
  type ComposeNudgeOutput,
} from "@smithers/agents";
import type { FollowUp } from "@smithers/vault";

import { getAgentRuntime } from "@/lib/server/agents";
import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  follow_up_id?: string;
  tone_override?: "soft" | "direct" | "force-decide";
  channel_hint?: "email" | "slack";
}

export interface ComposeNudgeResponse {
  ok: boolean;
  output?: ComposeNudgeOutput;
  /** Surfaced in the UI when the model returns adaptive thinking. */
  reasoning?: string;
  /** Token usage for telemetry. */
  usage?: { input_tokens: number; output_tokens: number };
  /** Friendly error message when ok=false. */
  error?: string;
  /** Specific error type, so the UI can render targeted CTAs. */
  error_kind?: "missing_api_key" | "follow_up_not_found" | "agent_failed";
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" } satisfies ComposeNudgeResponse,
      { status: 400 },
    );
  }

  if (!body.follow_up_id) {
    return NextResponse.json(
      {
        ok: false,
        error: "follow_up_id is required",
      } satisfies ComposeNudgeResponse,
      { status: 400 },
    );
  }

  const runtime = await getAgentRuntime();
  if (!runtime) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "missing_api_key",
        error:
          "ANTHROPIC_API_KEY not set. Add it to apps/web/.env.local and restart pnpm dev.",
      } satisfies ComposeNudgeResponse,
      { status: 412 },
    );
  }

  const vault = await getVault();
  const { active } = await vault.listFollowUps();
  const followUp = active.find((f) => f.follow_up_id === body.follow_up_id);
  if (!followUp) {
    return NextResponse.json(
      {
        ok: false,
        error_kind: "follow_up_not_found",
        error: `Follow-up ${body.follow_up_id} not found among active rows.`,
      } satisfies ComposeNudgeResponse,
      { status: 404 },
    );
  }

  // Match the follow-up to a project by fuzzy name. Best-effort; the
  // agent can still draft something useful without a project match.
  const projects = await vault.listProjects();
  const project = matchProject(followUp, projects);

  // Style guide is optional — pass it when available so drafts sound
  // like the user.
  const styleGuide = await vault.readStyleGuide().catch(() => null);

  const daysWaiting = computeDaysWaiting(followUp);

  try {
    const result = await composeFollowUpNudge(runtime, {
      followUp,
      project,
      daysWaiting,
      style: styleGuide?.body
        ? { label: "Katie's writing style", body: styleGuide.body }
        : undefined,
      toneOverride: body.tone_override,
      channelHint: body.channel_hint,
    });

    return NextResponse.json({
      ok: true,
      output: result.output,
      reasoning: result.reasoning,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
    } satisfies ComposeNudgeResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error_kind: "agent_failed",
        error: message,
      } satisfies ComposeNudgeResponse,
      { status: 502 },
    );
  }
}

function matchProject<T extends { name: string; partner?: string }>(
  followUp: FollowUp,
  projects: T[],
): T | undefined {
  const haystack = followUp.project.toLowerCase();
  return projects.find((p) => {
    const name = p.name.toLowerCase();
    const partner = p.partner?.toLowerCase() ?? "";
    return haystack.includes(name) || (partner && haystack.includes(partner));
  });
}

function computeDaysWaiting(followUp: FollowUp): number | undefined {
  // Prefer follow_up_by (the date the nudge was due) over sent — a
  // follow-up sent yesterday with a 7-day window isn't "waiting" yet.
  const reference = followUp.follow_up_by ?? followUp.sent;
  if (!reference) return undefined;
  const ts = Date.parse(reference);
  if (Number.isNaN(ts)) return undefined;
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}
