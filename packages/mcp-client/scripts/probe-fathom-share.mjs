// Probe Fathom's MCP: does list_meetings (or any other tool) expose a
// public share URL distinct from the internal /calls/ URL?
//
// Run from repo root:
//   node --import tsx/esm packages/mcp-client/scripts/probe-fathom-share.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "mcp-remote", "https://api.fathom.ai/mcp"],
});
const client = new Client({ name: "smithers-probe", version: "0.0.1" });
await client.connect(transport);

console.log("[1] tool list:");
const tools = await client.listTools();
for (const t of tools.tools) {
  console.log(`  - ${t.name}: ${(t.description ?? "").slice(0, 120)}`);
}

console.log("\n[2] list_meetings sample (first 1200 chars):");
const result = await client.callTool({
  name: "list_meetings",
  arguments: { limit: 2 },
});
const text = result?.content?.map((c) => c?.text ?? "").join("\n") ?? "";
console.log(text.slice(0, 1200));

await client.close();
process.exit(0);
