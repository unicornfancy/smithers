#!/usr/bin/env node
// One-shot probe: dump the raw text Fathom's list_meetings returns so we can
// see whether attendee/email data is exposed (currently dropped by the parser).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const since = new Date();
since.setDate(since.getDate() - 14);
since.setHours(0, 0, 0, 0);

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "mcp-remote", "https://api.fathom.ai/mcp"],
});

const client = new Client(
  { name: "smithers-probe", version: "0.0.1" },
  { capabilities: {} },
);

console.error("Connecting to Fathom MCP...");
await client.connect(transport);
console.error("Connected. Calling list_meetings...");

const result = await client.callTool({
  name: "list_meetings",
  arguments: {
    max_pages: 1,
    created_after: since.toISOString(),
    include_summary: false,
  },
});

const content = (result.content ?? []);
for (const c of content) {
  if (c.type === "text") {
    console.log("=== RAW list_meetings TEXT ===");
    console.log(c.text);
    console.log("=== END ===");
  } else {
    console.log("non-text content:", JSON.stringify(c).slice(0, 200));
  }
}

await client.close();
