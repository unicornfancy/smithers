/**
 * Thin wrapper around the official MCP SDK's stdio transport. Each
 * instance owns a long-lived child process (e.g. `npx -y
 * @automattic/mcp-context-a8c`) and routes tool calls through it.
 *
 * Design notes:
 * - The first call lazy-connects; subsequent calls reuse the
 *   connection. Spawning npx is slow (~1s) and we don't want to
 *   pay that on every request.
 * - Failures during connect bubble up to the caller, which decides
 *   whether to fall back to mock data or surface the error.
 * - The wrapper is intentionally generic — any stdio-launched MCP
 *   server can be wrapped, not just context-a8c.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface StdioMcpOptions {
  /** Human label for logs / errors (e.g. "context-a8c"). */
  label: string;
  /** Executable to spawn. */
  command: string;
  /** Arguments for the executable. */
  args: readonly string[];
  /** Environment overrides. Inherited from process.env by default. */
  env?: Record<string, string>;
  /** Optional cwd. */
  cwd?: string;
}

export class StdioMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly opts: StdioMcpOptions) {}

  /**
   * Get the underlying MCP Client, connecting on first call. Concurrent
   * calls during the first connect share the same in-flight Promise so
   * we don't spawn the subprocess twice.
   */
  async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Convenience for the common case: name + arguments → parsed JSON
   * payload. context-a8c (and most MCPs) wrap responses as a
   * `content[0].text` JSON string; we unwrap and parse it here so
   * callers work with typed objects.
   *
   * Throws when the response has no text content. Returns null when
   * text is present but isn't JSON — that's a common shape for
   * upstream errors like "Project not found", and the caller usually
   * wants to degrade to an empty result rather than crash.
   */
  async callJsonTool<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T | null> {
    const client = await this.getClient();
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text;
    if (typeof text !== "string") {
      throw new Error(
        `MCP tool "${name}" on ${this.opts.label} returned no text content`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Plain-text responses (usually upstream errors): caller decides.
      return null;
    }
  }

  /** Tear down the subprocess. Safe to call multiple times. */
  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close().catch(() => {
        /* ignore — process may already be gone */
      });
    }
  }

  private async connect(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: this.opts.command,
      args: [...this.opts.args],
      env: this.opts.env,
      cwd: this.opts.cwd,
    });
    const client = new Client(
      { name: "smithers", version: "0.0.1" },
      { capabilities: {} },
    );
    await client.connect(transport);
    return client;
  }
}
