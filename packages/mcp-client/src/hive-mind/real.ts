/**
 * Real Hive Mind transport — spawns the team's Hive Mind MCP server
 * (built at `<hive-mind-repo>/mcp/server/dist/index.js`) over stdio
 * and routes tool calls through it.
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
    if (!opts.hiveMindServerPath) {
      throw new Error(
        "RealHiveMindTransport requires hiveMindServerPath. Either set it in McpClientOptions or pass mockHiveMind: true.",
      );
    }
    this.mcp = new StdioMcpClient({
      label: "hive-mind",
      command: "node",
      args: [opts.hiveMindServerPath],
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
}
