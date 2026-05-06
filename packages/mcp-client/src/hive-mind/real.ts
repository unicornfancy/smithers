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
  CreatePartnerArgs,
  CreateProjectArgs,
  HiveMindClient,
  HiveMindPartnerSummary,
  HiveMindProjectSummary,
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

  async listPartners(): Promise<HiveMindPartnerSummary[]> {
    const text = await this.callTextTool("list-partners", {});
    if (!text) return [];
    return parsePartnerTable(text);
  }

  async listProjects(partner?: string): Promise<HiveMindProjectSummary[]> {
    const args: Record<string, unknown> = {};
    if (partner) args["partnerSlug"] = partner;
    const text = await this.callTextTool("list-projects", args);
    if (!text) return [];
    return parseProjectTable(text);
  }

  async createPartner(args: CreatePartnerArgs): Promise<void> {
    await this.mcp.callJsonTool("create-partner", { ...args });
  }

  async createProject(args: CreateProjectArgs): Promise<void> {
    await this.mcp.callJsonTool("create-project", { ...args });
  }

  /** Raw text fetch for tools that return markdown tables, not JSON. */
  private async callTextTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const client = await this.mcp.getClient();
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as Array<{
        type: string;
        text?: string;
      }>;
      const text = content.find((c) => c.type === "text")?.text;
      return typeof text === "string" && text.trim().length > 0 ? text : null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown-table parsers (server returns pipe-delimited tables)
// ---------------------------------------------------------------------------

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^-+$/.test(c));
}

function tableDataRows(text: string): string[][] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map(splitTableRow)
    .filter((cells) => !isSeparatorRow(cells))
    .slice(1); // drop header
}

// "Title (slug)" — used for both partner and project name columns.
function splitTitleSlug(cell: string): { title: string; slug: string } {
  const m = cell.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (m) return { title: m[1]!.trim(), slug: m[2]!.trim() };
  return { title: cell.trim(), slug: cell.trim() };
}

function parsePartnerTable(text: string): HiveMindPartnerSummary[] {
  // Columns: Partner | Description | Owner | NDA
  return tableDataRows(text)
    .filter((cells) => cells.length >= 4)
    .map((cells) => {
      const { title, slug } = splitTitleSlug(cells[0] ?? "");
      const owner = cells[2] ?? "";
      const ndaCell = (cells[3] ?? "").toLowerCase();
      return { slug, title, owner, nda: ndaCell === "yes" };
    });
}

function parseProjectTable(text: string): HiveMindProjectSummary[] {
  // Columns: Partner | Project | Status | Priority | Owner
  return tableDataRows(text)
    .filter((cells) => cells.length >= 5)
    .map((cells) => {
      const partnerSlug = (cells[0] ?? "").trim();
      const { title, slug: projectSlug } = splitTitleSlug(cells[1] ?? "");
      return {
        partnerSlug,
        projectSlug,
        title,
        status: cells[2] ?? "",
        priority: cells[3] ?? "",
        owner: cells[4] ?? "",
      };
    });
}
