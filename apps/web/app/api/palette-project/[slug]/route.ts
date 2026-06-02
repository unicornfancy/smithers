import { NextResponse } from "next/server";

import { filterFollowUpsForProject, parseProjectTasks } from "@smithers/vault";

import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";

/**
 * Live project context for the Ask Smithers palette. Hits the vault
 * directly on each request — no cache — so View status / Mark task done
 * always reflect the latest state. The vault read is fast enough that
 * adding a layer here would just complicate invalidation.
 *
 * Slug comes from the palette entry's `project_slug` (vault projects only).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  try {
    const vault = await getVault();
    const detail = await vault.readProjectDetail(slug);
    if (!detail) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const tasks = parseProjectTasks(detail.body);
    const openTasks = tasks
      .filter((t) => !t.done)
      .map((t) => ({
        task_id: t.task_id,
        text: t.text,
        section: t.section ?? null,
      }));

    const followUps = await vault.listFollowUps().catch(() => ({
      active: [],
      resolved: [],
    }));
    const projectFollowUps = filterFollowUpsForProject(followUps.active, {
      name: detail.name,
      slug: detail.slug,
      partner: detail.partner,
    });

    return NextResponse.json({
      ok: true,
      name: detail.name,
      slug: detail.slug,
      status: detail.status,
      priority: detail.priority ?? null,
      kind: detail.kind,
      partner: detail.partner ?? null,
      modified_at: detail.modified_at,
      zendesk_ticket_count: (detail.zendesk_tickets ?? []).length,
      open_tasks: openTasks,
      open_followups_count: projectFollowUps.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "palette-project failed" },
      { status: 500 },
    );
  }
}
