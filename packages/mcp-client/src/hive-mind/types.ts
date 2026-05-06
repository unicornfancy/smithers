// Public types for the Hive Mind client.

import type { PartnerProfile, SourceResult } from "../types";

export interface PartnerLookupQuery {
  /** Partner slug as stored in info.md frontmatter `partner:`. */
  partner_slug: string;
}

export interface KnowledgeSearchQuery {
  /** Free-text query. */
  query: string;
  /** Cap on results returned. Defaults to 10. */
  limit?: number;
}

export interface KnowledgeSearchHit {
  title: string;
  excerpt: string;
  /** Relative path within the Hive Mind repo. */
  path: string;
  /** Whether the source carries an NDA flag. */
  nda: boolean;
  is_mock?: boolean;
}

/** Lightweight partner row used by the onboarding picker. */
export interface HiveMindPartnerSummary {
  slug: string;
  title: string;
  owner: string;
  nda: boolean;
}

/** Lightweight project row used by the onboarding picker. */
export interface HiveMindProjectSummary {
  partnerSlug: string;
  projectSlug: string;
  title: string;
  status: string;
  priority: string;
  owner: string;
}

export interface CreatePartnerArgs {
  slug: string;
  title: string;
  description: string;
  owner: string;
  nda?: boolean;
}

export interface CreateProjectArgs {
  partner: string;
  project: string;
  title: string;
  description: string;
  status?: string;
  priority?: string;
  owner?: string;
  platform?: string;
}

export interface HiveMindClient {
  getPartner(
    query: PartnerLookupQuery,
  ): Promise<SourceResult<PartnerProfile | null>>;

  searchKnowledge(
    query: KnowledgeSearchQuery,
  ): Promise<SourceResult<KnowledgeSearchHit[]>>;

  writeProjectFile(
    partner: string,
    project: string,
    filename: string,
    content: string,
  ): Promise<void>;

  writePartnerFile(
    partner: string,
    filename: string,
    content: string,
  ): Promise<void>;

  commit(message: string): Promise<{ sha: string; message: string }>;

  updateProjectInfo(
    partner: string,
    project: string,
    fields: Record<string, unknown>,
  ): Promise<void>;

  addProjectNote(
    partner: string,
    project: string,
    date: string,
    heading: string,
    body: string,
  ): Promise<void>;

  /** All partners in the Hive Mind repo; powers the onboarding picker. */
  listPartners(): Promise<HiveMindPartnerSummary[]>;

  /** Projects in the Hive Mind repo, optionally scoped to one partner. */
  listProjects(partner?: string): Promise<HiveMindProjectSummary[]>;

  /** Scaffold a new partner folder. Slug must match ^[a-z0-9]+(-[a-z0-9]+)*$. */
  createPartner(args: CreatePartnerArgs): Promise<void>;

  /** Scaffold a new project under an existing partner. Slug regex applies. */
  createProject(args: CreateProjectArgs): Promise<void>;
}
