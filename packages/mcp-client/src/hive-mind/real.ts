/**
 * Real Hive Mind transport — talks to the team's Hive Mind MCP server
 * via stdio. The server binary isn't published yet; this transport is
 * wired up now so the interface is correct and the switch to real mode
 * is a one-line config change.
 *
 * Tool naming convention: tool names are kebab-case and called directly
 * (no provider-router hop like context-a8c uses).
 */

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import { StdioMcpClient } from "../stdio-mcp";
import type { PartnerProfile, SourceResult } from "../types";
import type {
  HiveMindClient,
  HiveMindProjectNotes,
  KnowledgeSearchHit,
  KnowledgeSearchQuery,
  PartnerLookupQuery,
} from "./types";

interface CommitResult {
  sha?: string;
  message?: string;
}

export class RealHiveMindTransport implements HiveMindClient {
  private readonly mcp: StdioMcpClient;

  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {
    this.mcp = new StdioMcpClient({
      label: "hive-mind",
      command: "npx",
      args: ["-y", "@automattic/mcp-hive-mind"],
    });
  }

  async getPartner(
    query: PartnerLookupQuery,
  ): Promise<SourceResult<PartnerProfile | null>> {
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "hive_mind",
        cacheKey: `real:hive_mind:partner:${query.partner_slug}`,
        ttl: this.opts.ttl.partnerProfile,
        fetcher: async () => {
          const result = await this.mcp.callJsonTool<PartnerProfile>(
            "get-partner",
            { partner: query.partner_slug },
          );
          return result ?? null;
        },
      },
    );
  }

  async searchKnowledge(
    query: KnowledgeSearchQuery,
  ): Promise<SourceResult<KnowledgeSearchHit[]>> {
    const limit = query.limit ?? 10;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "hive_mind",
        cacheKey: `real:hive_mind:search:${query.query}:${limit}`,
        ttl: this.opts.ttl.partnerProfile,
        fetcher: async () => {
          const result = await this.mcp.callJsonTool<KnowledgeSearchHit[]>(
            "search-knowledge",
            { query: query.query, limit },
          );
          return Array.isArray(result) ? result : [];
        },
      },
    );
  }

  async writeProjectFile(
    partner: string,
    project: string,
    filename: string,
    content: string,
  ): Promise<void> {
    await this.mcp.callJsonTool("write-project-file", {
      partner,
      project,
      filename,
      content,
    });
  }

  async writePartnerFile(
    partner: string,
    filename: string,
    content: string,
  ): Promise<void> {
    await this.mcp.callJsonTool("write-partner-file", {
      partner,
      filename,
      content,
    });
  }

  async commit(message: string): Promise<{ sha: string; message: string }> {
    const result = await this.mcp.callJsonTool<CommitResult>("commit", {
      message,
    });
    return {
      sha: result?.sha ?? "",
      message: result?.message ?? message,
    };
  }

  async updateProjectInfo(
    partner: string,
    project: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await this.mcp.callJsonTool("update-project-info", {
      partner,
      project,
      fields,
    });
  }

  async addProjectNote(
    partner: string,
    project: string,
    date: string,
    heading: string,
    body: string,
  ): Promise<void> {
    await this.mcp.callJsonTool("add-project-note", {
      partner,
      project,
      date,
      heading,
      body,
    });
  }

  async getHiveMindNotes(
    partner: string,
    project: string,
  ): Promise<HiveMindProjectNotes | null> {
    const result = await this.mcp
      .callJsonTool<{ content: string }>("get-project-notes", {
        partner,
        project,
      })
      .catch(() => null);
    if (!result?.content) return null;
    return { body: result.content };
  }
}
