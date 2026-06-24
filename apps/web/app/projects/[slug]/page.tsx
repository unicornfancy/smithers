import { notFound } from "next/navigation";

import {
  filterFollowUpsForProject,
  parseProjectTasks,
  splitTasks,
  type FollowUp,
  type FollowUpRow,
  type HiveMindFollowUpsData,
} from "@smithers/vault";

export type LinkedFollowUpEntry = FollowUp & { has_activity: boolean };
export type LinkedFollowUpMap = Map<string, LinkedFollowUpEntry>;

import { LiveActivityFeed } from "@/components/live-activity-feed";
import { NeedsDecisionPanel } from "@/components/needs-decision-panel";
import { ZendeskThreadsPanel } from "@/components/zendesk-threads-panel";
import { PageShell } from "@/components/page-shell";
import { type SectionDef } from "@/components/section-list";
import { WorkbenchLayoutSwitcher } from "@/components/workbench-layout-switcher";
import { WorkbenchHeader } from "@/components/workbench-header";
import { ProjectStatusCard } from "@/components/project-status-card";
import { HiveMindDraftsSection } from "@/components/hive-mind-drafts-section";
import { AgendaPanel } from "@/components/agenda-panel";
import { PartnerCard } from "@/components/partner-card";
import { ProjectHandoffSection } from "@/components/project-handoff-section";
import { ProjectLaunchPostSection } from "@/components/project-launch-post-section";
import { ProjectSitrepSection } from "@/components/project-sitrep-section";
import { ProjectBriefSection } from "@/components/project-brief-section";
import {
  CallNotesPanel,
  DraftsForProjectPanel,
  FollowUpsForProjectPanel,
  MilestonesPanel,
  OpenItemsPanel,
  PartnerInfoPanel,
  PersonalNotesPanel,
  ProjectLogPanel,
} from "@/components/workbench-panels";
import { ForYouTodayPanel } from "@/components/for-you-today-panel";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import { loadConfig } from "@/lib/server/config";
import { listQaRuns } from "@/lib/server/kosh";
import { getMcpClient } from "@/lib/server/mcp";
import { findAgendaForPartner } from "@/lib/server/agenda-for-partner";
import { recordingMatchesProject } from "@/lib/server/recording-match";
import { getTranscriptionAdapter } from "@/lib/server/transcription";
import { detectStallsForProject } from "@/lib/server/stalls";
import { getVault } from "@/lib/server/vault";

interface Params {
  slug: string;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const vault = await getVault();
  const project = vault.status().exists
    ? await vault.readProject(slug).catch(() => null)
    : null;
  return {
    title: project ? `${project.name} · Smithers` : "Project · Smithers",
  };
}

export default async function ProjectWorkbenchPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const vault = await getVault();

  if (!vault.status().exists) {
    notFound();
  }

  const detail = await vault.readProjectDetail(slug);
  if (!detail) {
    notFound();
  }

  const cfg = await loadConfig();
  // Pull project-scoped data in parallel.
  const mcp = await getMcpClient();
  const hmPartnerSlug = detail.hive_mind_partner_slug ?? detail.slug;
  const hmProjectSlug = detail.hive_mind_project_slug ?? detail.slug;
  // Bare absolute path (no file:// prefix). PartnerCard hands this to
  // an OpenInEditorButton which shells out to `open` / `xdg-open` —
  // browsers silently block file:// links from http:// pages, so the
  // old approach rendered a no-op link.
  const hmPartnerKnowledgePath = vault.options.hiveMindPath
    ? `${vault.options.hiveMindPath}/knowledge/partners/${hmPartnerSlug}/partner-knowledge.md`
    : null;
  // Fallback edit path when no brief exists yet — opens the canonical
  // location so a freshly-generated brief from /create-brief lands
  // somewhere predictable. When a brief is found, we prefer the
  // brief's own source_path (resolved via getHiveMindBrief's fallback
  // chain) so the link points at the actual file on disk.
  const hmBriefFallbackPath = vault.options.hiveMindPath
    ? `file://${vault.options.hiveMindPath}/knowledge/partners/${hmPartnerSlug}/${hmProjectSlug}/briefs/project-brief.md`
    : null;
  const hmIsConfigured = Boolean(detail.hive_mind_partner_slug);
  const [
    allDrafts,
    allFollowUps,
    activityResult,
    partnerResult,
    recordingsResult,
    stalls,
    agentStatus,
    linearProject,
    linearPhaseIssues,
    linearUpdates,
    projectNotes,
    hiveMindPartner,
    callTranscripts,
    hiveMindDrafts,
    hiveMindZendesk,
    hiveMindFollowUps,
    hiveMindBrief,
    hiveMindProject,
    agendaForPartner,
    qaRuns,
    processedCallNotes,
    driveActivityResult,
  ] = await Promise.all([
      vault.listDrafts().catch(() => []),
      vault
        .listFollowUps()
        .catch(() => ({ active: [], resolved: [] }) as never),
      mcp.contextA8C.listProjectActivity({
        project_slug: detail.slug,
        project_name: detail.name,
        limit: 20,
        refs: {
          github_repo: detail.github_repo,
          linear_project_id: detail.linear_project_id,
          linear_project_slug: detail.linear_project_slug,
          zendesk_tickets: detail.zendesk_tickets?.map((t) => t.id),
          slack_channel: detail.slack_channel,
          partner: detail.partner,
          p2_url: detail.p2_url,
        },
      }),
      detail.partner
        ? mcp.hiveMind.getPartner({ partner_slug: detail.partner })
        : Promise.resolve(null),
      (await getTranscriptionAdapter()).listRecordings({ limit: 200 }),
      detectStallsForProject(vault, detail.slug, detail.name).catch(() => ({
        items: [],
        counts: {
          force_decide: 0,
          escalate: 0,
          nudge: 0,
          next_nudge_upcoming: 0,
        },
      })),
      getAgentRuntimeStatus(),
      detail.linear_project_id
        ? mcp.linear.getProject(detail.linear_project_id).catch(() => null)
        : Promise.resolve(null),
      detail.linear_project_id
        ? mcp.linear.getProjectIssues(detail.linear_project_id).catch(() => [])
        : Promise.resolve([]),
      detail.linear_project_id
        ? mcp.linear.getProjectUpdates(detail.linear_project_id).catch(() => [])
        : Promise.resolve([]),
      vault.getHiveMindNotes(hmPartnerSlug, hmProjectSlug).catch(() => null),
      vault.getHiveMindPartner(hmPartnerSlug).catch(() => null),
      vault.getHiveMindCallTranscripts(hmPartnerSlug, hmProjectSlug).catch(() => []),
      vault.getHiveMindDrafts(hmPartnerSlug, hmProjectSlug).catch(() => []),
      vault.getHiveMindZendesk(hmPartnerSlug, hmProjectSlug).catch(() => null),
      vault.getHiveMindFollowUps(hmPartnerSlug, hmProjectSlug).catch(() => null),
      vault.getHiveMindBrief(hmPartnerSlug, hmProjectSlug).catch(() => null),
      vault.getHiveMindProject(hmPartnerSlug, hmProjectSlug).catch(() => null),
      findAgendaForPartner(detail.partner).catch(() => null),
      listQaRuns(detail.slug).catch(() => []),
      vault.listCallNotesForProject(detail.slug).catch(() => []),
      (async () => {
        // Drive activity rides alongside the context-a8c feed when a
        // folder URL is set and the Drive MCP is configured. Parse the
        // folder id out of the URL; if either is missing, short-circuit
        // to an empty fresh result so the feed doesn't render a
        // "Drive degraded" badge for projects without Drive.
        const folderId = parseDriveFolderId(detail.google_drive_url);
        if (!folderId) {
          return {
            ok: true as const,
            data: [],
            from: "fresh" as const,
            fetched_at: new Date().toISOString(),
          };
        }
        const since = new Date(
          Date.now() - 14 * 24 * 60 * 60 * 1000,
        ).toISOString();
        return mcp.googleDrive
          .listFolderActivity({
            folder_id: folderId,
            project_slug: detail.slug,
            project_display: detail.name,
            since,
            limit: 20,
          })
          .catch(() => ({
            ok: true as const,
            data: [],
            from: "fresh" as const,
            fetched_at: new Date().toISOString(),
          }));
      })(),
    ]);

  // Find the active phase (first started issue) and fetch its subtasks.
  const activePhaseIssue =
    linearPhaseIssues.find((i) => i.state.type === "started") ?? null;
  const activePhaseSubtasks = activePhaseIssue
    ? await mcp.linear
        .getSubtasks(activePhaseIssue.identifier)
        .catch(() => [])
    : [];

  const partnerProfile =
    partnerResult && partnerResult.ok
      ? partnerResult.data
      : (partnerResult?.cachedData ?? null);

  // Per-ticket summaries for the threads panel. One MCP call per
  // configured ticket — fan out in parallel, drop any that resolve to
  // null (parse failures or already-deleted tickets).
  // Read tickets straight from frontmatter — subject/status are
  // persisted at attach time, so the panel renders without an upstream
  // call. Bare-id entries (legacy) get rendered with subject:null and
  // can be backfilled via the panel's Refresh button.
  const zendeskTicketRefs = detail.zendesk_tickets ?? [];
  const zendeskTickets = zendeskTicketRefs.map((ref) => ({
    id: ref.id,
    subject: ref.subject ?? null,
    status: ref.status ?? null,
    priority: ref.priority ?? null,
    updated_at: ref.updated_at ?? null,
    url: `https://automattic.zendesk.com/agent/tickets/${ref.id}`,
  }));

  // Prefer Hive-Mind zendesk.md as the ticket source when connected.
  const effectiveZendeskTickets = hiveMindZendesk
    ? hiveMindZendesk.tickets.map((t) => ({
        id: String(t.ticket_id),
        subject: t.subject || null,
        status: t.status || null,
        priority: null as string | null,
        updated_at: null as string | null,
        url: t.url,
      }))
    : zendeskTickets;

  // Eager-fetch recent comments only for *active* tickets — closed
  // ones go into a folded disclosure that the user usually won't open,
  // so paying for the round-trip up front is wasteful. The panel
  // gracefully shows an empty disclosure when comments aren't passed.
  const activeTicketIds = new Set(
    zendeskTickets
      .filter((t) => {
        const s = t.status?.toLowerCase() ?? "";
        return s !== "solved" && s !== "closed";
      })
      .map((t) => t.id),
  );
  type ActivityList = Awaited<
    ReturnType<typeof mcp.contextA8C.fetchZendeskTicketActivity>
  >;
  const recentActivityByTicketId: Record<string, ActivityList> = {};
  await Promise.all(
    Array.from(activeTicketIds).map(async (id) => {
      try {
        recentActivityByTicketId[id] = await mcp.contextA8C
          .fetchZendeskTicketActivity(id, {
            projectSlug: detail.slug,
            limit: 5,
          });
      } catch {
        recentActivityByTicketId[id] = [];
      }
    }),
  );

  // Filter Fathom recordings to those whose title looks like it
  // belongs to this project — match against project name, partner
  // slug, or partner display name. Imperfect but cheap; the user
  // gets to see what hit and can tweak naming if matches are off.
  const allRecordings = recordingsResult.ok
    ? recordingsResult.data
    : (recordingsResult.cachedData ?? []);
  const projectRecordings = allRecordings.filter((r) =>
    recordingMatchesProject(r, {
      name: detail.name,
      partner: detail.partner,
      partner_display_name: partnerProfile?.display_name,
      fathom_search_terms: detail.fathom_search_terms,
      fathom_excluded_recording_ids: detail.fathom_excluded_recording_ids,
      partner_contact_emails: (hiveMindPartner?.contacts ?? []).map(
        (c) => c.email,
      ),
      partner_contact_names: (hiveMindPartner?.contacts ?? [])
        .map((c) => c.name?.trim())
        .filter((n): n is string => Boolean(n)),
    }),
  );

  // Cross-link Fathom recordings to any saved Call Notes file we've
  // already analyzed. Lookup is per-recording; cheap because the
  // helper only reads frontmatter on each candidate file.
  const savedCallNotesByRecordingId: Record<
    string,
    { relative_path: string; analyzed_at: string }
  > = {};
  await Promise.all(
    projectRecordings.map(async (r) => {
      const saved = await vault
        .findCallNotesByRecordingId(r.recording_id)
        .catch(() => null);
      if (saved) {
        savedCallNotesByRecordingId[r.recording_id] = {
          relative_path: saved.relative_path,
          analyzed_at: saved.analyzed_at,
        };
      }
    }),
  );

  const projectDrafts = allDrafts.filter(
    (d) => d.project_slug === detail.slug,
  );
  const projectFollowUps = {
    active: filterFollowUpsForProject(allFollowUps.active, detail),
    resolved: filterFollowUpsForProject(allFollowUps.resolved, detail),
  };

  // Prefer Hive-Mind follow-ups.md as the data source when connected.
  const detailName = detail.name;
  function hmFollowUpToVault(row: FollowUpRow): FollowUp {
    const st = row.source_type as "zendesk" | "github" | "slack" | undefined;
    return {
      follow_up_id: row.id,
      project: detailName,
      task: row.task,
      sent: row.sent_date || "",
      follow_up_by: row.follow_by || undefined,
      status: row.status.toLowerCase().includes("resolved") ? "resolved" : "waiting",
      source_type: st || undefined,
      source_ref: row.source_ref || undefined,
    };
  }
  const effectiveFollowUps = hiveMindFollowUps
    ? {
        active: hiveMindFollowUps.active.map(hmFollowUpToVault),
        resolved: hiveMindFollowUps.resolved.map(hmFollowUpToVault),
      }
    : projectFollowUps;

  // Merge Drive events into the activity feed. Drive lives in its own
  // MCP / cache, but the UI consumes a single feed so we splice it in
  // here, preserving the context-a8c result's ok/from status as the
  // source of truth (Drive degradation just thins out the feed).
  const driveEvents = driveActivityResult.ok
    ? driveActivityResult.data
    : (driveActivityResult.cachedData ?? []);
  const mergedActivityResult = activityResult.ok
    ? {
        ...activityResult,
        data: [...activityResult.data, ...driveEvents].sort(
          (a, b) => b.timestamp.localeCompare(a.timestamp),
        ),
      }
    : {
        ...activityResult,
        cachedData: [
          ...(activityResult.cachedData ?? []),
          ...driveEvents,
        ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      };

  // Build a map from source_ref → follow-up + whether the source shows activity
  // that arrived after the follow-up was sent (= response detected).
  const linkedFollowUpMap: LinkedFollowUpMap = new Map();
  const activityEvents = mergedActivityResult.ok
    ? mergedActivityResult.data
    : (mergedActivityResult.cachedData ?? []);
  for (const fu of projectFollowUps.active) {
    if (!fu.source_type || !fu.source_ref) continue;
    let has_activity = false;
    if (fu.source_type === "github") {
      // Event id format: github:{repo}:issue:{number}
      const match = activityEvents.find(
        (e) =>
          e.source === "github" &&
          e.id.endsWith(`:issue:${fu.source_ref}`) &&
          e.timestamp > (fu.sent ?? ""),
      );
      has_activity = Boolean(match);
    } else if (fu.source_type === "zendesk") {
      const ref = (detail.zendesk_tickets ?? []).find(
        (t) => t.id === fu.source_ref,
      );
      if (ref) {
        const s = (ref.status ?? "").toLowerCase();
        has_activity = s === "pending" || s === "solved";
      }
    }
    linkedFollowUpMap.set(fu.source_ref, { ...fu, has_activity });
  }

  const tasks = parseProjectTasks(detail.body);
  const { open, done } = splitTasks(tasks);

  const isPartner = detail.kind === "partner";

  const configuredSources = [
    {
      label: "Slack",
      configured: Boolean(detail.slack_channel),
      reason: !detail.slack_channel ? "no channel configured" : undefined,
    },
    {
      label: "GitHub",
      configured: Boolean(detail.github_repo),
      reason: !detail.github_repo ? "no repo configured" : undefined,
    },
    {
      label: "Linear",
      configured: Boolean(
        detail.linear_project_id || detail.linear_project_slug,
      ),
      reason:
        !detail.linear_project_id && !detail.linear_project_slug
          ? "no project configured"
          : undefined,
    },
    {
      label: "Zendesk",
      configured: (detail.zendesk_tickets ?? []).length > 0,
      reason:
        (detail.zendesk_tickets ?? []).length > 0
          ? undefined
          : "no tickets configured",
    },
    {
      label: "P2",
      // Anchored on the partner's own P2: comments on it + cross-posts
      // linking back to it. No p2_url → no P2 path at all.
      configured: Boolean(detail.p2_url),
      reason: detail.p2_url ? undefined : "no P2 url",
    },
    {
      label: "GDrive",
      configured: Boolean(detail.google_drive_url),
      reason: detail.google_drive_url ? undefined : "no folder url",
    },
  ];

  const sections: SectionDef[] = [];

  sections.push({
    id: "needs-decision",
    title: "Needs decision",
    node: (
      <NeedsDecisionPanel
        summary={stalls}
        apiKeyConfigured={agentStatus.configured}
      />
    ),
  });

  sections.push({
    id: "for-you-today",
    title: "For you today",
    node: (
      <ForYouTodayPanel
        project={detail}
        apiKeyConfigured={agentStatus.configured}
      />
    ),
  });

  if (isPartner) {
    sections.push({
      id: "milestones",
      title: "Milestones",
      node: <MilestonesPanel deadlines={detail.deadlines} />,
    });
  }

  sections.push({
    id: "live-activity",
    title: "Live activity",
    node: (
      <LiveActivityFeed
        result={mergedActivityResult}
        configured={configuredSources}
        linkedFollowUps={linkedFollowUpMap}
        projectSlug={detail.slug}
        projectName={detail.name}
      />
    ),
  });

  if (linearProject) {
    sections.push({
      id: "project-status",
      title: "Project status",
      node: (
        <ProjectStatusCard
          linearProject={linearProject}
          linearPhaseIssues={linearPhaseIssues}
          activePhaseSubtasks={activePhaseSubtasks}
        />
      ),
    });
  }

  const briefTranscriptOptions = callTranscripts.map((t) => ({
    path: `knowledge/partners/${hmPartnerSlug}/${hmProjectSlug}/call-transcripts/${t.filename}`,
    title: t.frontmatter.title ?? t.filename.replace(/\.md$/i, ""),
    date: t.frontmatter.date ?? null,
  }));

  sections.push({
    id: "project-brief",
    title: "Project brief",
    node: (
      <ProjectBriefSection
        brief={hiveMindBrief}
        editPath={
          hiveMindBrief?.source_path
            ? `file://${hiveMindBrief.source_path}`
            : hmBriefFallbackPath
        }
        projectSlug={detail.slug}
        canGenerate={hmIsConfigured}
        transcripts={briefTranscriptOptions}
        initialDiscoveryDocUrl={hiveMindProject?.discovery_doc_url ?? ""}
        initialRegistrar={hiveMindPartner?.domain_registrar ?? ""}
        initialDns={hiveMindPartner?.dns_provider ?? ""}
      />
    ),
  });

  sections.push({
    id: "project-log",
    title: "Project log",
    node: (
      <ProjectLogPanel
        project={detail}
        projectNotes={projectNotes}
        linearUpdates={linearUpdates}
      />
    ),
  });

  sections.push({
    id: "project-sitrep",
    title: "SITREP",
    node: (
      <ProjectSitrepSection
        projectSlug={detail.slug}
        projectName={detail.name}
        p2Url={detail.p2_url}
      />
    ),
  });

  sections.push({
    id: "agenda",
    title: "Agenda",
    node: (
      <AgendaPanel
        agenda={agendaForPartner}
        projectName={detail.name}
        partnerSlug={detail.partner}
        editorHref={
          agendaForPartner
            ? `/agendas/${agendaSlug(agendaForPartner.filename)}`
            : null
        }
      />
    ),
  });

  sections.push({
    id: "open-items",
    title: "Open items",
    node: (
      <OpenItemsPanel
        projectSlug={detail.slug}
        projectName={detail.name}
        open={open}
        done={done}
        githubRepo={detail.github_repo}
      />
    ),
  });

  sections.push({
    id: "follow-ups",
    title: "Follow-ups",
    node: (
      <FollowUpsForProjectPanel
        followUps={effectiveFollowUps}
        projectName={detail.name}
        projectSlug={detail.slug}
        defaultWindowDays={cfg.follow_ups?.default_window_days ?? 7}
      />
    ),
  });

  sections.push({
    id: "drafts-for-project",
    title: "Drafts",
    node: (
      <div className="space-y-3">
        <DraftsForProjectPanel
          drafts={projectDrafts}
          projectName={detail.name}
        />
        {hiveMindDrafts.length > 0 ? (
          <HiveMindDraftsSection drafts={hiveMindDrafts} />
        ) : null}
      </div>
    ),
  });

  sections.push({
    id: "zendesk-threads",
    title: "Zendesk threads",
    node: (
      <ZendeskThreadsPanel
        projectSlug={detail.slug}
        tickets={effectiveZendeskTickets}
        refreshHints={[
          partnerProfile?.display_name ?? "",
          detail.partner ? detail.partner.replace(/-/g, " ") : "",
          detail.name,
        ].filter(Boolean)}
        savedSearchTerms={detail.zendesk_search_terms ?? []}
        followUps={effectiveFollowUps}
        recentActivityByTicketId={recentActivityByTicketId}
        defaultSearchQuery={
          partnerProfile?.display_name ?? detail.partner ?? detail.name
        }
        alwaysShow={isPartner}
        linkedFollowUps={linkedFollowUpMap}
        projectName={detail.name}
      />
    ),
  });

  sections.push({
    id: "recent-calls",
    title: "Recent calls",
    node: (
      <CallNotesPanel
        projectSlug={detail.slug}
        projectName={detail.name}
        recordings={projectRecordings}
        savedNotesByRecordingId={savedCallNotesByRecordingId}
        callTranscripts={callTranscripts}
        processedCallNotes={processedCallNotes}
      />
    ),
  });

  if (isPartner) {
    sections.push({
      id: "partner-info",
      title: "Partner info",
      node: <PartnerInfoPanel project={detail} partner={partnerProfile} />,
    });
  }

  sections.push({
    id: "personal-notes",
    title: "Personal notes",
    node: <PersonalNotesPanel notes={detail.notes} />,
  });

  sections.push({
    id: "partner-profile",
    title: "Partner profile",
    node: (
      <PartnerCard
        partner={hiveMindPartner}
        editAbsPath={hmPartnerKnowledgePath}
        smithersEditHref={
          detail.hive_mind_partner_slug
            ? `/partner-knowledge/${detail.hive_mind_partner_slug}`
            : null
        }
        hmIsConfigured={hmIsConfigured}
      />
    ),
  });

  // Wrap-up artifacts (launch post + handoff). HM-gated since both
  // write into the project's HM folder. Launch-post sits right under
  // partner-profile in the knowledge tab — the post is a piece of
  // partner/project knowledge; handoff is the lifecycle-end action
  // below it.
  if (detail.hive_mind_partner_slug) {
    sections.push({
      id: "project-launch-post",
      title: "Launch post",
      node: (
        <ProjectLaunchPostSection
          projectSlug={detail.slug}
          defaultSiteUrl={detail.production_url}
        />
      ),
    });
    sections.push({
      id: "project-handoff",
      title: "Project handoff",
      node: (
        <ProjectHandoffSection
          projectSlug={detail.slug}
          preparedBy={cfg.identity.name ?? ""}
        />
      ),
    });
  }

  const workbenchCounts = {
    open_tasks: open.length,
    open_follow_ups: effectiveFollowUps.active.length,
    zendesk_tickets: (detail.zendesk_tickets ?? []).length,
    last_touched_at: detail.modified_at,
  };

  return (
    <>
      <WorkbenchHeader
        project={detail}
        preparedBy={cfg.identity.name ?? ""}
        counts={workbenchCounts}
      />
      <PageShell className="max-w-5xl">
        <WorkbenchLayoutSwitcher
          projectSlug={detail.slug}
          sections={sections}
          qaRunsCount={qaRuns.length}
        />
      </PageShell>
    </>
  );
}


/**
 * Mirror of the slugifier used by /agendas/[slug] route — kept inline
 * here so we don't pull a "use server" file into the RSC page. Any
 * change to the slug shape needs to be made in both spots.
 */
function agendaSlug(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract the folder ID from a Google Drive folder URL. Drive folder
 * URLs always look like `https://drive.google.com/drive/folders/<id>`
 * (with optional `?usp=…` trailing). Returns null when the input is
 * empty or doesn't match.
 */
function parseDriveFolderId(url: string | undefined): string | null {
  if (!url) return null;
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(url);
  return m?.[1] ?? null;
}
