import "server-only";

import type {
  Draft,
  FollowUp,
  Project,
} from "@smithers/vault";

import type { UserActionRow } from "./user-actions";
import { getVault } from "./vault";

export interface ActionDescription {
  /** First line — usually the task / message excerpt. */
  title: string;
  /** Second line — project, source, partner. */
  subtitle?: string;
  /** Whether the entity could still be looked up. False = orphan. */
  resolved: boolean;
}

/**
 * Lazily-built lookup tables for resolving raw user_action entity_ids
 * back into human strings. The Activity Log builds this once per
 * render and reuses it across all rows.
 */
export interface ResolverTables {
  followUpsById: Map<string, FollowUp>;
  draftsById: Map<string, Draft>;
  projectsBySlug: Map<string, Project>;
}

export async function buildResolverTables(): Promise<ResolverTables> {
  const vault = await getVault();
  if (!vault.status().exists) {
    return {
      followUpsById: new Map(),
      draftsById: new Map(),
      projectsBySlug: new Map(),
    };
  }
  const [followUps, drafts, projects] = await Promise.all([
    vault.listFollowUps().catch(() => ({ active: [], resolved: [] })),
    vault.listDrafts().catch(() => []),
    vault.listProjects().catch(() => []),
  ]);
  const followUpsById = new Map<string, FollowUp>();
  for (const f of followUps.active) followUpsById.set(f.follow_up_id, f);
  for (const f of followUps.resolved) followUpsById.set(f.follow_up_id, f);
  const draftsById = new Map(drafts.map((d) => [d.draft_id, d]));
  const projectsBySlug = new Map(projects.map((p) => [p.slug, p]));
  return { followUpsById, draftsById, projectsBySlug };
}

/**
 * Resolve a single user_action row to a human label. Falls back to
 * the raw entity_id in a code tag when the entity is gone (renamed,
 * deleted, or just out-of-range of the current vault snapshot).
 */
export function describeAction(
  row: UserActionRow,
  tables: ResolverTables,
): ActionDescription {
  switch (row.entity_type) {
    case "ping":
      return describePing(row.entity_id);
    case "follow_up":
      return describeFollowUp(row.entity_id, tables);
    case "stall":
      return describeStall(row.entity_id, tables);
    case "top3_candidate":
      return describeTop3Candidate(row.entity_id, tables);
  }
}

function describePing(entityId: string): ActionDescription {
  // ping IDs look like "ping:<source>:<project_slug>:<minutesAgo>"
  const parts = entityId.split(":");
  if (parts.length >= 3 && parts[0] === "ping") {
    const source = parts[1] ?? "?";
    const slug = parts[2] ?? "?";
    return {
      title: `Inbound ping · ${prettySource(source)}`,
      subtitle: prettySlug(slug),
      resolved: true,
    };
  }
  return { title: entityId, resolved: false };
}

function describeFollowUp(
  followUpId: string,
  tables: ResolverTables,
): ActionDescription {
  const fu = tables.followUpsById.get(followUpId);
  if (!fu) return { title: `Follow-up ${shortHash(followUpId)}`, resolved: false };
  return {
    title: fu.task,
    subtitle: fu.project,
    resolved: true,
  };
}

function describeStall(
  stallEntityId: string,
  tables: ResolverTables,
): ActionDescription {
  // Stall IDs from detectStalls look like "fu:<follow_up_id>" or
  // "next_nudge:<project_slug>". Strip the namespace and resolve.
  if (stallEntityId.startsWith("fu:")) {
    const desc = describeFollowUp(stallEntityId.slice(3), tables);
    return { ...desc, subtitle: appendBadge(desc.subtitle, "stall") };
  }
  if (stallEntityId.startsWith("next_nudge:")) {
    const slug = stallEntityId.slice("next_nudge:".length);
    const project = tables.projectsBySlug.get(slug);
    return {
      title: project ? `Touchpoint reminder for ${project.name}` : `Touchpoint reminder · ${slug}`,
      subtitle: project?.partner ?? "scheduled nudge",
      resolved: Boolean(project),
    };
  }
  return { title: stallEntityId, resolved: false };
}

function describeTop3Candidate(
  candidateId: string,
  tables: ResolverTables,
): ActionDescription {
  // Candidate IDs are "<source>:<source_id>" or
  // "project_task:<slug>:<task_id>".
  const sepIdx = candidateId.indexOf(":");
  if (sepIdx === -1) return { title: candidateId, resolved: false };
  const source = candidateId.slice(0, sepIdx);
  const rest = candidateId.slice(sepIdx + 1);

  switch (source) {
    case "ping":
      return describePing(`ping:${rest}`);
    case "follow_up": {
      const desc = describeFollowUp(rest, tables);
      return { ...desc, subtitle: appendBadge(desc.subtitle, "Top 3 pick") };
    }
    case "draft": {
      const draft = tables.draftsById.get(rest);
      if (!draft) return { title: `Draft ${shortHash(rest)}`, resolved: false };
      return {
        title: `Finish draft — ${draft.title}`,
        subtitle: draft.project_slug
          ? prettySlug(draft.project_slug)
          : "no project",
        resolved: true,
      };
    }
    case "project_task": {
      // rest is "<project_slug>:<task_id>"
      const slugSep = rest.indexOf(":");
      if (slugSep === -1) return { title: candidateId, resolved: false };
      const slug = rest.slice(0, slugSep);
      const project = tables.projectsBySlug.get(slug);
      return {
        title: project
          ? `Open task · ${project.name}`
          : `Open task · ${prettySlug(slug)}`,
        subtitle: "checkbox in project body",
        resolved: Boolean(project),
      };
    }
  }
  return { title: candidateId, resolved: false };
}

function prettySource(source: string): string {
  switch (source) {
    case "slack":
      return "Slack";
    case "p2":
      return "P2";
    case "zendesk":
      return "Zendesk";
    case "github":
      return "GitHub";
    case "linear":
      return "Linear";
    default:
      return source;
  }
}

function prettySlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length <= 3 ? part.toUpperCase() : capitalize(part)))
    .join(" ");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

function shortHash(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function appendBadge(
  subtitle: string | undefined,
  badge: string,
): string {
  return subtitle ? `${subtitle} · ${badge}` : badge;
}
