import { NextResponse } from "next/server";

import {
  interpretPaletteQuery,
  type InterpretPaletteEntry,
  type InterpretPaletteOpenFollowUpHint,
  type InterpretPaletteOpenTaskHint,
} from "@smithers/agents";
import { parseProjectTasks } from "@smithers/vault";

import { getAgentRuntime } from "@/lib/server/agents";
import { getPaletteIndex } from "@/lib/server/palette-index";
import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";

const MAX_ENTRIES = 150;
const MAX_OPEN_TASKS = 80;

/**
 * The "Ask Smithers" LLM dispatcher. Takes a free-form query, picks one
 * structured intent + params, and returns a confirmation message the
 * palette can show before actually running anything.
 *
 * The agent never mutates state — it interprets only. The palette
 * confirms with the user, then re-uses the existing server actions
 * (addProjectTaskAction, toggleProjectTaskAction, etc.) to run.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { query?: string }
    | null;
  const query = body?.query?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const runtime = await getAgentRuntime();
  if (!runtime) {
    return NextResponse.json(
      {
        ok: false,
        reason: "not-configured",
        message: "Set ANTHROPIC_API_KEY in apps/web/.env.local to enable Ask Smithers.",
      },
      { status: 200 },
    );
  }

  try {
    const palette = await getPaletteIndex();
    const entries: InterpretPaletteEntry[] = palette.entries
      .slice(0, MAX_ENTRIES)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        description: e.description,
        project_slug: e.project_slug,
        partner_slug: e.partner_slug,
        href: e.href,
      }));

    const [openTasks, openFollowUps] = await Promise.all([
      collectOpenTasks(palette.entries),
      collectOpenFollowUps(),
    ]);

    const result = await interpretPaletteQuery(runtime, {
      query,
      entries,
      open_tasks: openTasks.slice(0, MAX_OPEN_TASKS),
      open_follow_ups: openFollowUps,
      today: new Date().toISOString().slice(0, 10),
    });
    return NextResponse.json({ ok: true, data: result.output });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : "palette-query failed",
      },
      { status: 200 },
    );
  }
}

async function collectOpenTasks(
  entries: Awaited<ReturnType<typeof getPaletteIndex>>["entries"],
): Promise<InterpretPaletteOpenTaskHint[]> {
  const vault = await getVault();
  const out: InterpretPaletteOpenTaskHint[] = [];
  const projectEntries = entries.filter(
    (e) => e.kind === "project-vault" && e.project_slug,
  );
  // Cap fan-out: most queries don't need every project's tasks. We pull
  // tasks for up to 30 projects (sorted by recency, which the index
  // already does for vault entries) and stop after 80 tasks total.
  for (const e of projectEntries.slice(0, 30)) {
    const slug = e.project_slug!;
    try {
      const detail = await vault.readProjectDetail(slug);
      if (!detail) continue;
      const tasks = parseProjectTasks(detail.body);
      for (const t of tasks) {
        if (t.done) continue;
        out.push({
          task_id: t.task_id,
          text: t.text,
          project_slug: slug,
        });
        if (out.length >= MAX_OPEN_TASKS) return out;
      }
    } catch {
      // Skip projects that fail to read; the rest still index.
    }
  }
  return out;
}

async function collectOpenFollowUps(): Promise<InterpretPaletteOpenFollowUpHint[]> {
  const vault = await getVault();
  try {
    const followUps = await vault.listFollowUps();
    return followUps.active.map((f) => ({
      follow_up_id: f.follow_up_id,
      task: f.task,
      project: f.project,
    }));
  } catch {
    return [];
  }
}
