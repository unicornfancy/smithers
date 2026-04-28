// Shared types for the vault layer.

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

/** Normalized project metadata from frontmatter (all fields optional except identity). */
export interface ProjectFrontmatter {
  project_id?: string;
  slug?: string;
  name?: string;
  kind?: ProjectKind;
  partner?: string;
  status?: ProjectStatus;

  github_repo?: string;
  staging_url?: string;
  production_url?: string;
  linear_project_id?: string;
  linear_project_slug?: string;
  zendesk_org?: string;
  p2_url?: string;

  primary_slack_channel?: string;
  team_slack_channel?: string;

  agenda_file?: string;
  next_nudge?: string;
  review_interval_days?: number;
  nda?: boolean;

  tags?: string[];
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

  /** Where this project lives in the filesystem. */
  source: ProjectSource;

  partner?: string;
  github_repo?: string;
  staging_url?: string;
  production_url?: string;
  linear_project_id?: string;
  linear_project_slug?: string;
  zendesk_org?: string;
  p2_url?: string;
  primary_slack_channel?: string;
  team_slack_channel?: string;
  agenda_file?: string;
  next_nudge?: string;
  review_interval_days?: number;
  nda?: boolean;
  tags: string[];

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
