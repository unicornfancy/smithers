// Probe #5: COMPLETE wpcom tool list (no truncation).
//
// Run from repo root:
//   node --import tsx/esm packages/mcp-client/scripts/probe-wpcom-tools.mjs

import { StdioMcpClient } from "../src/stdio-mcp";

const mcp = new StdioMcpClient({
  label: "context-a8c",
  command: "npx",
  args: ["-y", "@automattic/mcp-context-a8c"],
});

const result = await mcp.callJsonTool("context-a8c-load-provider", {
  provider: "wpcom",
});
console.log("tool names:", (result?.tools ?? []).map((t) => t.name).join(", "));

await mcp.close();
process.exit(0);
