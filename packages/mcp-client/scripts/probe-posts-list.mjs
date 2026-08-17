// Probe posts.list response shape on the team P2 (authenticated search).
//
// Run from repo root:
//   node --import tsx/esm packages/mcp-client/scripts/probe-posts-list.mjs

import { StdioMcpClient } from "../src/stdio-mcp";

const mcp = new StdioMcpClient({
  label: "context-a8c",
  command: "npx",
  args: ["-y", "@automattic/mcp-context-a8c"],
});

const result = await mcp.callJsonTool("context-a8c-execute-tool", {
  provider: "wpcom",
  tool: "content-authoring",
  params: {
    wpcom_site: "team51projects.wordpress.com",
    action: "execute",
    operation: "posts.list",
    params: {
      search: "Week 33",
      per_page: 5,
      include_fields: ["id", "title", "link", "date"],
    },
  },
});

console.log("top-level type:", Array.isArray(result) ? "array" : typeof result);
console.log(JSON.stringify(result, null, 2).slice(0, 1500));

await mcp.close();
process.exit(0);
