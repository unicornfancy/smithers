// Smoke test for @smithers/mcp-client.
//
// Run from the package dir:
//
//     node --import tsx/esm scripts/smoke.mjs
//
// Or from the repo root:
//
//     node --import tsx/esm packages/mcp-client/scripts/smoke.mjs
//
// Exercises every public method of the mock client and prints a concise
// summary so we can eyeball the shape and freshness signals.

import { createMcpClient } from "../src/index";

const client = createMcpClient({ mock: true });

console.log("config:", client.config);
console.log("");

const project = {
  project_slug: "climatefirst-foundation-phase-2",
  project_name: "ClimateFirst Foundation Phase 2",
  refs: {
    github_repo: "automattic/climatefirst",
    linear_project_slug: "climatefirst-phase-2",
    primary_slack_channel: "team-climatefirst",
    p2_url: "https://team51.wordpress.com/2026/02/01/phase-2-kickoff/",
    zendesk_tickets: ["11134851"],
    partner: "climatefirst-foundation",
  },
};

const activity1 = await client.contextA8C.listProjectActivity(project);
const activity2 = await client.contextA8C.listProjectActivity(project);

console.log(
  `activity (1st call): ok=${activity1.ok} from=${activity1.ok ? activity1.from : "-"} count=${activity1.ok ? activity1.data.length : 0}`,
);
console.log(
  `activity (2nd call): ok=${activity2.ok} from=${activity2.ok ? activity2.from : "-"} (should be 'cache')`,
);
if (activity1.ok) {
  console.log("first 3 activity events:");
  for (const e of activity1.data.slice(0, 3)) {
    console.log(
      `  ${e.timestamp} ${e.source.padEnd(7)} ${e.kind.padEnd(22)} ${e.actor?.name ?? ""}: ${e.title}`,
    );
  }
}
console.log("");

const pings = await client.contextA8C.listPings({ limit: 5 });
console.log(
  `pings: ok=${pings.ok} count=${pings.ok ? pings.data.length : 0}`,
);
if (pings.ok) {
  for (const p of pings.data) {
    console.log(
      `  ${p.timestamp} ${p.source.padEnd(7)} ${p.from.name}: ${p.excerpt.slice(0, 60)}…`,
    );
  }
}
console.log("");

const partner = await client.hiveMind.getPartner({
  partner_slug: "climatefirst-foundation",
});
console.log(
  `partner: ok=${partner.ok} present=${partner.ok && !!partner.data} from=${partner.ok ? partner.from : "-"}`,
);
if (partner.ok && partner.data) {
  console.log(
    `  ${partner.data.display_name} (nda=${partner.data.nda}) team=${partner.data.team.length}`,
  );
}
console.log("");

const search = await client.hiveMind.searchKnowledge({ query: "launch" });
console.log(
  `searchKnowledge: ok=${search.ok} hits=${search.ok ? search.data.length : 0}`,
);
console.log("");

const rec = await client.fathom.listRecordings({ limit: 5 });
console.log(
  `recordings: ok=${rec.ok} count=${rec.ok ? rec.data.length : 0} (mock returns 0)`,
);
console.log("");

console.log("health snapshot:");
for (const h of client.health()) {
  console.log(
    `  ${h.source.padEnd(20)} ${h.status} (last_success=${h.last_success_at ?? "-"})`,
  );
}
