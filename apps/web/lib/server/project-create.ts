import "server-only";

import type {
  ProjectFrontmatter,
  ProjectKind,
  ProjectStatus,
} from "@smithers/vault";

/**
 * Best-effort parser for Linear project URLs. Linear URLs look like:
 *   https://linear.app/<org>/project/<slug>-<id-suffix>
 *   https://linear.app/<org>/project/<slug>
 * The trailing 12-char hex suffix on team-scoped URLs is the project's
 * UUID-ish identifier; when present we hand it through as
 * `linear_project_id`. We always set `linear_project_slug` to the slug
 * portion so context-a8c's linear/issues tool can filter by name when
 * the id isn't usable.
 */
export function parseLinearUrl(url: string): {
  linear_project_slug?: string;
  linear_project_id?: string;
} {
  const trimmed = url.trim();
  if (!trimmed) return {};
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {};
  }
  if (!parsed.hostname.endsWith("linear.app")) return {};
  const parts = parsed.pathname.split("/").filter(Boolean);
  // Expect: <org>/project/<slug-with-or-without-id-suffix>
  const projectIdx = parts.indexOf("project");
  if (projectIdx === -1) return {};
  const slugSegment = parts[projectIdx + 1];
  if (!slugSegment) return {};
  // Linear appends the project id as a 12-hex suffix (e.g.
  // "commerce-in-a-box-bad7efc58ddf"). Detect + split.
  const match = slugSegment.match(/^(.+)-([0-9a-f]{12})$/);
  if (match) {
    return {
      linear_project_slug: match[1],
      linear_project_id: match[2],
    };
  }
  return { linear_project_slug: slugSegment };
}

/**
 * Parse a GitHub URL (or `owner/repo` shorthand) into the
 * `owner/repo` shape the github_repo frontmatter expects.
 */
export function parseGithubInput(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  // Already in `owner/repo` shape?
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed.hostname.endsWith("github.com")) return undefined;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  // Strip trailing .git, /tree/..., /pulls, etc.
  return `${parts[0]}/${parts[1]!.replace(/\.git$/, "")}`;
}

/** Strip a leading "#" from a Slack channel input. */
export function normalizeSlackChannel(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) return trimmed.slice(1);
  return trimmed;
}

/**
 * Parse a multi-line textarea input into a clean array of Zendesk
 * ticket refs. Each non-empty line is one ticket — raw IDs and full
 * URLs both pass through as-is; the activity fetcher + threads
 * panel re-parse them via extractTicketId from @smithers/mcp-client.
 */
export function parseZendeskTicketsInput(
  text: string | undefined,
): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export interface CreateProjectFormInput {
  name: string;
  /** Optional explicit slug; derived from name when blank. */
  slug?: string;
  kind: ProjectKind;
  status?: ProjectStatus;
  /** Required for kind=partner; the Hive Mind dir slug. */
  partner_slug?: string;
  /** Free-form Linear URL or empty. */
  linear_url?: string;
  /** Free-form GitHub URL or owner/repo. */
  github_input?: string;
  /** Live URL the project is currently being built against — fed to Kosh QA runs. */
  dev_url?: string;
  slack_channel?: string;
  /**
   * Zendesk threads (Automattic Zendesk). One per line, raw IDs or
   * full URLs. First entry becomes the primary thread.
   */
  zendesk_tickets_text?: string;
  p2_url?: string;
  nda?: boolean;
  /** Comma-separated tag list. */
  tags_csv?: string;
  /** ISO date for cold-project seasonal nudges. */
  next_nudge?: string;
}

/**
 * Translate the raw form input into a clean ProjectFrontmatter, ready
 * to hand to vault.createProject. Pulls slugs/ids out of pasted URLs
 * and drops fields that came in empty so the frontmatter stays tight.
 */
export function buildProjectFrontmatterFromForm(
  input: CreateProjectFormInput,
): Partial<ProjectFrontmatter> {
  const out: Partial<ProjectFrontmatter> = {};
  if (input.kind === "partner" && input.partner_slug?.trim()) {
    out.partner = input.partner_slug.trim();
  }
  if (input.linear_url?.trim()) {
    const parsed = parseLinearUrl(input.linear_url);
    if (parsed.linear_project_slug) {
      out.linear_project_slug = parsed.linear_project_slug;
    }
    if (parsed.linear_project_id) {
      out.linear_project_id = parsed.linear_project_id;
    }
  }
  if (input.github_input?.trim()) {
    const repo = parseGithubInput(input.github_input);
    if (repo) out.github_repo = repo;
  }
  if (input.dev_url?.trim()) out.dev_url = input.dev_url.trim();
  if (input.slack_channel?.trim()) {
    out.slack_channel = normalizeSlackChannel(input.slack_channel);
  }
  const tickets = parseZendeskTicketsInput(input.zendesk_tickets_text);
  if (tickets.length > 0) out.zendesk_tickets = tickets;
  if (input.p2_url?.trim()) out.p2_url = input.p2_url.trim();
  if (input.nda) out.nda = true;
  if (input.next_nudge?.trim()) out.next_nudge = input.next_nudge.trim();
  if (input.tags_csv?.trim()) {
    const tags = input.tags_csv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 0) out.tags = tags;
  }
  return out;
}
