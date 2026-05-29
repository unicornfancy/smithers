"use server";

import { revalidatePath } from "next/cache";

import {
  composeWeeklyUpdate,
  type WeeklyUpdateOutput,
  type WeeklyUpdateProjectFacts,
} from "@smithers/agents";
import type { ActivityKind } from "@smithers/mcp-client";

import { getAgentRuntime } from "@/lib/server/agents";
import { loadConfig } from "@/lib/server/config";
import { loadStyleReference } from "@/lib/server/style";
import { getVault } from "@/lib/server/vault";
import {
  collectWeeklyFacts,
  type WeeklyFacts,
} from "@/lib/server/weekly-facts";

/**
 * Run the weekly-update agent over the facts collector's output for
 * the given ISO week. Returns the markdown body the editor pre-fills
 * (with an Edit + Save flow on top). Doesn't persist — saving is a
 * separate action so the user can iterate on the prompt without each
 * regen overwriting their edits.
 */
export async function generateWeeklyUpdateAction(
  isoWeek: string,
  opts?: { user_notes?: string },
): Promise<
  | { ok: true; data: WeeklyUpdateOutput; facts: WeeklyFacts }
  | { ok: false; reason: "not-configured" | "no-facts" | "error"; message?: string }
> {
  if (!isoWeek) return { ok: false, reason: "error", message: "isoWeek is required" };
  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const facts = await collectWeeklyFacts(isoWeek);
  if (!facts) {
    return { ok: false, reason: "error", message: "Couldn't compute facts for this week" };
  }
  if (facts.projects.length === 0) {
    return { ok: false, reason: "no-facts", message: "No partner / team projects found" };
  }

  const cfg = await loadConfig();
  const style = (await loadStyleReference()) ?? undefined;
  const projectFacts: WeeklyUpdateProjectFacts[] = facts.projects.map((p) => ({
    slug: p.slug,
    name: p.name,
    partner: p.partner,
    status: p.status,
    event_lines: p.events.map(eventToLine).slice(0, 30),
    linear_updates: p.linearUpdates.map((u) => ({
      date: u.createdAt.slice(0, 10),
      body: u.body,
      health: u.health ?? undefined,
    })),
    calls: p.recentCalls.map((c) => ({
      title: c.title,
      date: c.recorded_at.slice(0, 10),
      summary: c.summary,
    })),
    drafts: p.recentDrafts.map((d) => ({
      title: d.title || d.draft_id,
    })),
  }));

  try {
    const result = await composeWeeklyUpdate(runtime, {
      iso_week: facts.iso_week,
      week_start: facts.week_start,
      week_end: facts.week_end,
      projects: projectFacts,
      format_instructions: cfg.weekly_update?.format_template,
      style,
      user_notes: opts?.user_notes,
    });
    return { ok: true, data: result.output, facts };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}

/**
 * Persist the user's edited weekly update body to vault
 * `Weekly Updates/<iso_week>.md`. Idempotent — re-saves overwrite
 * with a fresh `last_saved_at`.
 *
 * When `original_body` is provided, it's stamped into frontmatter so
 * the learn-from-weekly-archives loop can later compute the diff
 * between the AI's first pass and the user's final edits. Subsequent
 * saves of the same week leave the existing snapshot in place
 * (pass null to explicitly clear, e.g. on regenerate).
 */
export async function saveWeeklyUpdateAction(input: {
  iso_week: string;
  body: string;
  original_body?: string | null;
}): Promise<{ ok: true; relative_path: string } | { ok: false; reason: string }> {
  if (!input.iso_week) return { ok: false, reason: "iso_week is required" };
  if (!input.body.trim()) return { ok: false, reason: "body is required" };
  try {
    const vault = await getVault();
    const result = await vault.saveWeeklyUpdate({
      iso_week: input.iso_week,
      body: input.body,
      original_body: input.original_body,
    });
    revalidatePath("/weekly-updates");
    revalidatePath(`/weekly-updates/${input.iso_week}`);
    return { ok: true, relative_path: result.relative_path };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Save failed",
    };
  }
}

function eventToLine(event: {
  kind: ActivityKind;
  source: string;
  timestamp: string;
  actor?: { name: string; handle?: string; is_external: boolean };
  title: string;
}): string {
  const date = event.timestamp.slice(0, 10);
  const who = event.actor
    ? event.actor.handle
      ? `${event.actor.name} (${event.actor.handle})${event.actor.is_external ? " [external]" : ""}`
      : event.actor.name
    : "unknown";
  return `[${date}] ${event.source}/${event.kind} — ${who}: ${event.title}`;
}
