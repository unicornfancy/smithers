import "server-only";

import type { Ping, ProjectActivityRefs } from "@smithers/mcp-client";
import type { Project, ProjectPriority } from "@smithers/vault";

import { getMcpClient } from "./mcp";
import { getVault } from "./vault";

/**
 * Backend signal helpers for `/today` v2.
 *
 * These compute the inputs for the importance-score + velocity panels.
 * They are deliberately defensive — every upstream call is wrapped in a
 * try/catch with a sentinel return so a flaky MCP session can't kill
 * the page render. /today is read-only; failure modes degrade to "no
 * signal" rather than throwing.
 */

const KNOWN_PRIORITIES: ReadonlySet<string> = new Set(["high", "medium", "low"]);

/**
 * Resolve the user-tagged priority for a project. Hive-Mind's
 * `info.md` priority takes precedence when the project is HM-linked;
 * otherwise we fall back to the vault frontmatter `priority` field.
 * Returns null when neither source has a value.
 */
export async function getProjectPriority(
  slug: string,
): Promise<ProjectPriority | null> {
  try {
    const vault = await getVault();
    const project = await vault.readProject(slug);
    if (!project) return null;

    if (project.hive_mind_partner_slug && project.hive_mind_project_slug) {
      try {
        const hm = await vault.getHiveMindProject(
          project.hive_mind_partner_slug,
          project.hive_mind_project_slug,
        );
        const hmPriority = coercePriority(hm?.priority);
        if (hmPriority) return hmPriority;
      } catch {
        // HM read failure shouldn't block the vault fallback below.
      }
    }

    return project.priority ?? null;
  } catch {
    return null;
  }
}

function coercePriority(raw: unknown): ProjectPriority | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  return KNOWN_PRIORITIES.has(lower) ? (lower as ProjectPriority) : null;
}

/**
 * Count activity events for a project in the last `days` (default 7),
 * summing across all sources that `listProjectActivity` returns. Used
 * to drive the "Moving fast" velocity strip on /today.
 *
 * Degrades to 0 on any failure — the strip should silently drop a
 * project rather than render an error.
 */
export async function getProjectActivityCount(
  projectSlug: string,
  opts?: { days?: number },
): Promise<number> {
  const days = opts?.days ?? 7;
  try {
    const vault = await getVault();
    const project = await vault.readProject(projectSlug);
    if (!project) return 0;
    return await countActivityForProject(project, days);
  } catch {
    return 0;
  }
}

/**
 * Batch variant — same shape as `getProjectActivityCount` but runs
 * sequentially across the project list. Sequential is fine: Smithers
 * has ~10 partner projects in practice, and serializing avoids
 * stampeding the ContextA8C MCP session.
 */
export async function getProjectActivityCounts(
  projectSlugs: string[],
  opts?: { days?: number },
): Promise<Record<string, number>> {
  const days = opts?.days ?? 7;
  const out: Record<string, number> = {};
  let vault;
  try {
    vault = await getVault();
  } catch {
    for (const slug of projectSlugs) out[slug] = 0;
    return out;
  }
  for (const slug of projectSlugs) {
    try {
      const project = await vault.readProject(slug);
      if (!project) {
        out[slug] = 0;
        continue;
      }
      out[slug] = await countActivityForProject(project, days);
    } catch {
      out[slug] = 0;
    }
  }
  return out;
}

async function countActivityForProject(
  project: Project,
  days: number,
): Promise<number> {
  const mcp = await getMcpClient();
  const refs: ProjectActivityRefs = {
    github_repo: project.github_repo,
    linear_project_id: project.linear_project_id,
    linear_project_slug: project.linear_project_slug,
    zendesk_tickets: project.zendesk_tickets?.map((t) => t.id),
    slack_channel: project.slack_channel,
    partner: project.partner,
  };
  const cutoff = Date.now() - days * 86_400_000;
  const result = await mcp.contextA8C.listProjectActivity({
    project_slug: project.slug,
    project_name: project.name,
    refs,
    // 50 is generous for a 7-day window across our partner volume; if
    // a hot project legitimately exceeds this in a week the count is
    // capped, which is acceptable for a velocity tiebreaker.
    limit: 50,
    since: new Date(cutoff).toISOString(),
  });
  if (!result.ok) {
    const cached = result.cachedData;
    if (!cached) return 0;
    return cached.filter((e) => withinWindow(e.timestamp, cutoff)).length;
  }
  return result.data.filter((e) => withinWindow(e.timestamp, cutoff)).length;
}

function withinWindow(timestamp: string, cutoffMs: number): boolean {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return false;
  return t >= cutoffMs;
}

/**
 * Per-ping importance score components consumed by the HOT pane.
 * Stays a separate context object (rather than inline lookups) so the
 * caller computes priorities + contacts + LLM picks once and applies
 * them across the full ping list.
 */
export interface PingImportanceContext {
  /** Project slug → priority (from getProjectPriority). */
  projectPriorities: Map<string, ProjectPriority | null>;
  /** Project slug → set of contact emails/handles from partner-knowledge.md. */
  projectContacts: Map<string, Set<string>>;
  /** Optional: LLM picks with confidence (from composeTopThree's gated output). */
  llmPicks?: Map<string, { confidence: number }>;
}

const LLM_CONFIDENCE_THRESHOLD = 0.7;
const STALENESS_CAP_DAYS = 5;

/**
 * Compute the hybrid importance score for a single ping.
 *
 * Components (additive):
 *   +30  matched project has priority "high"
 *   +20  ping author email/handle matches the project's contacts
 *   +25  ping is in `llmPicks` and the LLM emitted confidence >= 0.7
 *   + min(5, daysWaiting)  small staleness tiebreaker
 *
 * Pings without a `project_match` only get the contact-bonus (when
 * `from.email/handle` is in *any* contacts set the caller passed —
 * but the caller is responsible for keying contacts on the matched
 * project, so unmatched pings effectively get LLM + staleness only).
 */
export function computePingImportanceScore(
  ping: Ping,
  ctx: PingImportanceContext,
): number {
  let score = 0;
  const projectSlug = ping.project_match?.project_slug;

  if (projectSlug) {
    const priority = ctx.projectPriorities.get(projectSlug) ?? null;
    if (priority === "high") {
      score += 30;
    }

    const contacts = ctx.projectContacts.get(projectSlug);
    if (contacts && contacts.size > 0 && pingMatchesContacts(ping, contacts)) {
      score += 20;
    }
  }

  if (ctx.llmPicks) {
    const pick = ctx.llmPicks.get(ping.id);
    if (pick && pick.confidence >= LLM_CONFIDENCE_THRESHOLD) {
      score += 25;
    }
  }

  score += stalenessBonus(ping.timestamp);
  return score;
}

function pingMatchesContacts(ping: Ping, contacts: Set<string>): boolean {
  // ActivityActor only carries `handle` today (Slack handle, GitHub
  // login, or email-shaped string from Zendesk). The contacts Set is
  // lowercased emails from Hive-Mind partner-knowledge.md, so a match
  // happens when the handle is itself an email. Author `name` is a
  // human display string and intentionally not part of the lookup.
  const handle = ping.from?.handle?.trim().toLowerCase();
  if (handle && contacts.has(handle)) return true;
  return false;
}

function stalenessBonus(timestamp: string): number {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return 0;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 0;
  return Math.min(STALENESS_CAP_DAYS, days);
}

/**
 * Collect every team member email known for a partner from the
 * Hive-Mind `partner-knowledge.md` file, lowercased and de-duplicated.
 *
 * We prefer the MCP `getPartner` here because it already parses the
 * structured `team:` array out of frontmatter — the vault helper only
 * returns a flat body string. Returns an empty Set when HM isn't
 * configured, the partner file is missing, or the upstream errors.
 */
export async function extractPartnerContacts(
  partnerSlug: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!partnerSlug.trim()) return out;
  try {
    const mcp = await getMcpClient();
    const result = await mcp.hiveMind.getPartner({ partner_slug: partnerSlug });
    const profile = result.ok ? result.data : (result.cachedData ?? null);
    if (!profile) return out;
    for (const member of profile.team) {
      const email = member.email?.trim().toLowerCase();
      if (email) out.add(email);
    }
  } catch {
    // Swallow — caller treats an empty set as "no contacts known".
  }
  return out;
}

/** Re-export for consumers that pin the ping shape via this module. */
export type { Ping } from "@smithers/mcp-client";
