// Probe listProjectActivity for The Pocket NYC Phase 2 against the real MCP.
//
// Run from repo root:
//   LINEAR_API_KEY=$(grep LINEAR_API_KEY apps/web/.env.local | cut -d= -f2) \
//     node --import tsx/esm packages/mcp-client/scripts/probe-pocket-activity.mjs

import { createMcpClient } from "../src/index";

const hmPath = "/Users/katherinemccanna/Team51-Hive-Mind/mcp/server/dist/index.js";

const client = createMcpClient({
  mockContextA8C: false,
  mockFathom: true,
  mockHiveMind: true,
  mockLinear: !process.env["LINEAR_API_KEY"],
  selfEmail: "katie.mccanna@a8c.com",
  hiveMindServerPath: hmPath,
});

const refs = {
  github_repo: "a8cteam51/thepocketnyc",
  linear_project_id: "8ca0b5d6870e",
  linear_project_slug: "the-pocket-nyc-phase-2",
  zendesk_tickets: ["11174602", "11134851", "11170127"],
  partner: "the-pocket-nyc",
};

console.log("Calling listProjectActivity for The Pocket NYC Phase 2...");
console.log("refs:", JSON.stringify(refs, null, 2));
console.log("");

const t0 = Date.now();
const result = await client.contextA8C.listProjectActivity({
  project_slug: "the-pocket-nyc-phase-2",
  project_name: "The Pocket NYC Phase 2",
  limit: 20,
  refs,
});
const elapsedMs = Date.now() - t0;

console.log(`took ${elapsedMs}ms`);
console.log(`ok=${result.ok}`);
if (result.ok) {
  console.log(`from=${result.from} count=${result.data.length}`);
  const bySource = new Map();
  for (const e of result.data) {
    bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
  }
  console.log("by source:", Object.fromEntries(bySource));
  console.log("");
  console.log("first 5 events:");
  for (const e of result.data.slice(0, 5)) {
    console.log(`  [${e.source}] ${e.timestamp} ${e.kind} — ${e.title}`);
  }
} else {
  console.log("error:", result.error);
  if (result.cachedData) console.log(`(have ${result.cachedData.length} cached events)`);
}

console.log("");
console.log("health snapshot:");
for (const h of client.health()) {
  console.log(`  ${h.source}: ${h.status}${h.lastError ? ` — ${h.lastError.message}` : ""}`);
}

process.exit(0);
