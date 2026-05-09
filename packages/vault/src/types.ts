// Shared types for the vault layer.

/**
 * A Zendesk ticket reference persisted to project frontmatter. The id
 * is mandatory; everything else is captured opportunistically when
 * the user attaches the ticket via the workbench (so the panel can
 * render subject + status without a fresh upstream lookup).
 */
export interface ZendeskTicketRef {
  /** Numeric ticket id as a string ("11134851"). */
  id: string;
  /** Subject captured at attach time. */
  subject?: string;
  /** Status captured at attach time ("open", "pending", "solved", etc.). */
  status?: string;
  /** Priority captured at attach time. */
  priority?: string;
  /** ISO timestamp from the upstream ticket record. */
  updated_at?: string;
}

export type ProjectKind = "partner" | "team" | "personal";

export type ProjectStatus =
  | "research"
  | "planning"
  | "active"
  | "hot"
  | "secondary"
  | "cold"
  | "at-risk"
  | "launched"
  | "archived";

/**
 * User-tagged importance signal. Coarse high/medium/low so the user can
 * tag a project once and have it influence ping scoring + /today layout
 * without needing to maintain a numeric priority.
 */
export type ProjectPriority = "high" | "medium" | "low";

/** Normalized project metadata from frontmatter (all fields optional except identity). */
export interface ProjectFrontmatter {
  project_id?: string;
  slug?: string;
  name?: string;
  kind?: ProjectKind;
  partner?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;

  github_repo?: string;
  staging_url?: string;
  production_url?: string;
  linear_project_id?: string;
  linear_project_slug?: string;
  /**
   * Zendesk tickets attached to this project. Each entry is either a
   * raw ticket id, a full URL, or a richer object with persisted
   * metadata (subject + status + updated_at + priority) captured at
   * attach time. The first entry is treated as the primary thread.
   *
   * Persisting subject/status in frontmatter is what lets Smithers
   * render the panel without an upstream lookup — markdown is the
   * source of truth.
   */
  zendesk_tickets?: Array<string | ZendeskTicketRef>;
  /**
   * Free-form text terms used by the Threads panel's "Refresh metadata"
   * flow to fan out searches at Zendesk and find tickets attached to
   * this project. Typically partner contact emails ("martin@example.com")
   * or names ("Martin Porter") that surface the right tickets in
   * Zendesk's search index when the bare partner slug doesn't.
   */
  zendesk_search_terms?: string[];
  /**
   * Free-form text terms used by the Recent Calls match logic — names,
   * email addresses, or partial domains that should route a Fathom
   * recording to this project even when the meeting title is generic.
   * The cheap heuristic checks against title + attendees by default;
   * these terms are an escape hatch when those don't suffice.
   */
  fathom_search_terms?: string[];
  p2_url?: string;

  primary_slack_channel?: string;
  team_slack_channel?: string;

  agenda_file?: string;
  next_nudge?: string;
  review_interval_days?: number;
  nda?: boolean;

  tags?: string[];

  /** Override the partner slug used when calling Hive Mind helpers (when it differs from the Smithers slug). */
  hive_mind_partner_slug?: string;
  /** Override the project slug used when calling Hive Mind helpers (when it differs from the Smithers slug). */
  hive_mind_project_slug?: string;
}

/** A project as Smithers sees it — sourced from vault info.md or a flat `Projects/<name>.md`. */
export interface Project {
  /** Stable id, generated and persisted on first read if missing. */
  project_id: string;
  /** kebab-case slug; derived from filename when not in frontmatter. */
  slug: string;
  /** Human-readable name; falls back to first H1 then to slug. */
  name: string;
  /** Defaults to `personal` for vault-only projects when not specified. */
  kind: ProjectKind;
  /** Defaults to `active` when not specified. */
  status: ProjectStatus;
  /** User-tagged priority; absent unless the user opted to tag the project. */
  priority?: ProjectPriority;

  /** Where this project lives in the filesystem. */
  source: ProjectSource;

  partner?: string;
  github_repo?: string;
  staging_url?: string;
  production_url?: string;
  linear_project_id?: string;
  linear_project_slug?: string;
  /**
   * Zendesk tickets attached to this project. Always normalized to the
   * rich object form by the parser — the on-disk YAML may store a
   * mix of bare strings and objects, but consumers always see
   * ZendeskTicketRef. The first entry is the primary thread.
   */
  zendesk_tickets?: ZendeskTicketRef[];
  /** See ProjectFrontmatter.zendesk_search_terms — same shape, always an array here. */
  zendesk_search_terms?: string[];
  /** See ProjectFrontmatter.fathom_search_terms — same shape, always an array here. */
  fathom_search_terms?: string[];
  p2_url?: string;
  primary_slack_channel?: string;
  team_slack_channel?: string;
  agenda_file?: string;
  next_nudge?: string;
  review_interval_days?: number;
  nda?: boolean;
  tags: string[];

  hive_mind_partner_slug?: string;
  hive_mind_project_slug?: string;

  /** First H1 header of the body, when present. Often equal to `name`. */
  heading?: string;
  /** Last filesystem mtime of the project's primary file. */
  modified_at: string;
}

export type ProjectSource =
  | { kind: "vault-flat"; absolute_path: string; relative_path: string }
  | { kind: "vault-folder"; absolute_path: string; relative_path: string; folder_path: string }
  | { kind: "hive-mind"; absolute_path: string; relative_path: string; partner: string };

export type DraftState = "in-progress" | "archived";

export interface DraftFrontmatter {
  draft_id?: string;
  project_id?: string;
  project_slug?: string;
  state?: DraftState;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  source?: string;
  tags?: string[];
  context_preview?: string;
  context_preview_label?: string;
  context_preview_meta?: string;
}

export interface Draft {
  draft_id: string;
  project_slug?: string;
  project_id?: string;
  state: DraftState;
  title: string;
  /** Path of the working draft (in `Drafts/`) or, when archived, the archived path. */
  absolute_path: string;
  relative_path: string;
  /** Path of the matching original brief in `Drafts/Originals/`, when present. */
  original_path?: string;
  /** Path of the archived copy in `Drafts/Archived Drafts/`, when present. */
  archived_path?: string;
  body: string;
  modified_at: string;
  context_preview?: string;
  context_preview_label?: string;
  context_preview_meta?: string;
  created_at?: string;
  archived_at?: string;
  tags: string[];
}

export type FollowUpStatus = "waiting" | "resolved" | "escalated";

export interface FollowUp {
  /** Stable id derived from project + task hash if no explicit id present. */
  follow_up_id: string;
  project: string;
  task: string;
  sent: string;
  follow_up_by?: string;
  status: FollowUpStatus;
  status_note?: string;
  source?: string;
  source_type?: "zendesk" | "github" | "slack";
  /** ticket_id for zendesk, issue number string for github, thread url for slack */
  source_ref?: string;
}

export interface DailyNote {
  date: string;
  absolute_path: string;
  relative_path: string;
  body: string;
  modified_at: string;
}

export interface VaultStatus {
  /** Whether the configured vault path exists. */
  exists: boolean;
  vault_path: string;
  /** Whether all expected top-level folders/files are present. */
  has_expected_layout: boolean;
  expected_paths: { path: string; kind: "dir" | "file"; present: boolean }[];
  /** True if the user explicitly opted out of having a vault (no-vault mode). */
  no_vault_mode?: boolean;
}
