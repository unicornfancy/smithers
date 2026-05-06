// Mock Hive Mind transport with canned partner profiles for the seed vault.
//
// Real implementation will call the user-installed Hive Mind MCP and fall
// back to direct filesystem reads of `Team51-Hive-Mind/Partners/<slug>/`
// when the MCP is unavailable.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import type { PartnerProfile, SourceResult } from "../types";
import type {
  HiveMindClient,
  KnowledgeSearchHit,
  KnowledgeSearchQuery,
  PartnerLookupQuery,
} from "./types";

const SEED_PARTNERS: Record<string, PartnerProfile> = {
  "climatefirst-foundation": {
    partner_slug: "climatefirst-foundation",
    display_name: "ClimateFirst Foundation",
    summary: [
      "Mid-sized environmental nonprofit funding regenerative agriculture and",
      "climate-tech research grants. Decision-making is collaborative across",
      "their digital, comms, and program teams; major decisions go to a",
      "monthly steering meeting.",
      "",
      "Communications style: warm, plain-language, no buzzwords. They review",
      "copy carefully and prefer two rounds of feedback over one big launch.",
    ].join("\n"),
    tags: ["nonprofit", "climate", "research-grants"],
    team: [
      {
        name: "Morgan Reed",
        role: "Director of Digital",
        email: "morgan@climatefirst.example",
        notes:
          "Primary day-to-day contact; copies the steering committee on launch reviews.",
      },
      {
        name: "Casey Brooks",
        role: "Editorial Lead",
        email: "casey@climatefirst.example",
        notes: "Owns content calendar and donor newsletter approval.",
      },
    ],
    nda: false,
    is_mock: true,
  },
  "annual-newsletter": {
    partner_slug: "annual-newsletter",
    display_name: "Annual Newsletter (cold)",
    summary: [
      "Long-running editorial relationship; we ship a year-end roundup each",
      "December. The partner team is small and only re-engages around the",
      "newsletter cycle, so the project sits cold most of the year by design.",
    ].join("\n"),
    tags: ["nonprofit", "editorial", "annual"],
    team: [],
    nda: false,
    is_mock: true,
  },
};

const SEED_KNOWLEDGE: KnowledgeSearchHit[] = [
  {
    title: "Working with ClimateFirst Foundation",
    excerpt:
      "Two-pass review preferred. Morgan owns sign-off; Casey owns donor copy.",
    path: "Partners/climatefirst-foundation/partner-knowledge.md",
    nda: false,
    is_mock: true,
  },
  {
    title: "Team51 launch checklist",
    excerpt:
      "Standard pre-launch sweep across staging, Linear, P2 announcement, and donor comms.",
    path: "Skills/launch-checklist.md",
    nda: false,
    is_mock: true,
  },
];

export class MockHiveMindTransport implements HiveMindClient {
  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {}

  async getPartner(
    query: PartnerLookupQuery,
  ): Promise<SourceResult<PartnerProfile | null>> {
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "hive_mind",
        cacheKey: `mock:hive_mind:partner:${query.partner_slug}`,
        ttl: this.opts.ttl.partnerProfile,
        fetcher: async () => SEED_PARTNERS[query.partner_slug] ?? null,
      },
    );
  }

  async searchKnowledge(
    query: KnowledgeSearchQuery,
  ): Promise<SourceResult<KnowledgeSearchHit[]>> {
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "hive_mind",
        cacheKey: `mock:hive_mind:search:${query.query}:${query.limit ?? 10}`,
        ttl: this.opts.ttl.partnerProfile,
        fetcher: async () => {
          const q = query.query.toLowerCase();
          const limit = query.limit ?? 10;
          const hits = SEED_KNOWLEDGE.filter(
            (h) =>
              h.title.toLowerCase().includes(q) ||
              h.excerpt.toLowerCase().includes(q),
          );
          return hits.slice(0, limit);
        },
      },
    );
  }

  async writeProjectFile(
    _partner: string,
    _project: string,
    _filename: string,
    _content: string,
  ): Promise<void> {
    // Mock: no-op — real transport writes to the Hive Mind MCP server.
  }

  async writePartnerFile(
    _partner: string,
    _filename: string,
    _content: string,
  ): Promise<void> {
    // Mock: no-op.
  }

  async commit(message: string): Promise<{ sha: string; message: string }> {
    return { sha: "mock-sha", message };
  }

  async updateProjectInfo(
    _partner: string,
    _project: string,
    _fields: Record<string, unknown>,
  ): Promise<void> {
    // Mock: no-op.
  }

  async addProjectNote(
    _partner: string,
    _project: string,
    _date: string,
    _heading: string,
    _body: string,
  ): Promise<void> {
    // Mock: no-op.
  }
}
