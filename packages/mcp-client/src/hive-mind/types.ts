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

export interface HiveMindClient {
  getPartner(
    query: PartnerLookupQuery,
  ): Promise<SourceResult<PartnerProfile | null>>;

  searchKnowledge(
    query: KnowledgeSearchQuery,
  ): Promise<SourceResult<KnowledgeSearchHit[]>>;
}
