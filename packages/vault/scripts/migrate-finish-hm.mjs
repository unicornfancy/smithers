// One-shot migration cleanup script.
//
// Finishes the vault → Hive-Mind migration for partner projects that
// already have `hive_mind_partner_slug` set in their vault frontmatter:
//
//   1. Backfills HM `follow-ups.md` from the vault's central Follow-ups.md
//      (mirrors the syncFollowUpsToHiveMind logic in
//      apps/web/app/projects/[slug]/actions.ts).
//   2. Strips `zendesk_tickets` + `zendesk_search_terms` from each vault
//      project file so HM `zendesk.md` becomes the source of truth.
//
// Run from repo root once the dual-write paths have populated HM's
// zendesk.md (re-attach a ticket per project to trigger that). After
// this script, the per-project workbench reads Zendesk + follow-ups
// from HM with no vault fallback needed.
//
//   LINEAR_API_KEY=$(grep LINEAR_API_KEY apps/web/.env.local | cut -d= -f2) \
//     node --import tsx/esm packages/vault/scripts/migrate-finish-hm.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import matter from "gray-matter";

import { createVault } from "../src/index";
import { createMcpClient } from "../../mcp-client/src/index";

// -----------------------------------------------------------------------------
// Config — read from config.local.yaml so paths match the running app.
// -----------------------------------------------------------------------------

function expandPath(p) {
  return p.replace(/^~(?=$|\/|\\)/, homedir());
}

const cfg = yaml.load(readFileSync("config.local.yaml", "utf-8"));
const vaultPath = expandPath(cfg.paths.vault);
const hmPath = expandPath(cfg.paths.hive_mind);
const hmServerPath = join(hmPath, "mcp/server/dist/index.js");

const vault = createVault({ vaultPath, hiveMindPath: hmPath });
const mcp = createMcpClient({
  mockContextA8C: true, // not needed for this script
  mockFathom: true,
  mockHiveMind: false,
  mockLinear: true,
  hiveMindServerPath: hmServerPath,
});

// -----------------------------------------------------------------------------
// Step 1: backfill HM follow-ups.md for every connected project.
// -----------------------------------------------------------------------------

console.log("\n=== Step 1: backfill HM follow-ups.md\n");

const projects = await vault.listProjects();
const allFollowUps = await vault.listFollowUps().catch(() => ({
  active: [],
  resolved: [],
}));

const { filterFollowUpsForProject } = await import("../src/follow-ups");

function buildFollowUpsMarkdown(project, active, resolved) {
  const header =
    "| id | task | sent_to | sent_date | follow_by | source_type | source_ref | status |";
  const sep = "| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |";
  const toRow = (f, status) =>
    `| ${f.follow_up_id} | ${f.task.replace(/\|/g, "\\|")} | ${project.name} | ${f.sent ?? ""} | ${f.follow_up_by ?? ""} | ${f.source_type ?? ""} | ${f.source_ref ?? ""} | ${status} |`;
  const rows = [
    ...active.map((f) => toRow(f, "active")),
    ...resolved.map((f) => toRow(f, "resolved")),
  ];
  return [header, sep, ...rows, ""].join("\n");
}

const connected = projects.filter((p) => p.hive_mind_partner_slug);
console.log(`Found ${connected.length} project(s) connected to Hive-Mind:`);
for (const p of connected) console.log(`  - ${p.name} (${p.slug})`);

for (const project of connected) {
  const hmPartner = project.hive_mind_partner_slug;
  const hmProject = project.hive_mind_project_slug ?? project.slug;
  const active = filterFollowUpsForProject(allFollowUps.active, {
    name: project.name,
    slug: project.slug,
    partner: undefined,
  });
  const resolved = filterFollowUpsForProject(allFollowUps.resolved, {
    name: project.name,
    slug: project.slug,
    partner: undefined,
  });
  console.log(
    `\n  ${project.name}: ${active.length} active + ${resolved.length} resolved → ${hmPartner}/${hmProject}/follow-ups.md`,
  );
  if (active.length + resolved.length === 0) {
    console.log("    (no follow-ups for this project — writing empty table)");
  }
  const content = buildFollowUpsMarkdown(project, active, resolved);
  try {
    await mcp.hiveMind.writeProjectFile(
      hmPartner,
      hmProject,
      "follow-ups.md",
      content,
    );
    await mcp.hiveMind.commit(
      `follow-ups: sync for ${hmPartner}/${hmProject}`,
    );
    console.log("    ok");
  } catch (err) {
    console.error(`    FAILED: ${err.message ?? err}`);
  }
}

// -----------------------------------------------------------------------------
// Step 2: strip zendesk_tickets + zendesk_search_terms from vault frontmatter.
// -----------------------------------------------------------------------------

console.log("\n=== Step 2: strip zendesk metadata from vault frontmatter\n");

const ZENDESK_KEYS = ["zendesk_tickets", "zendesk_search_terms"];
let stripped = 0;
for (const project of projects) {
  if (project.source.kind !== "vault-flat" && project.source.kind !== "vault-folder") {
    continue;
  }
  const path = project.source.absolute_path;
  const raw = readFileSync(path, "utf-8");
  const parsed = matter(raw);
  const data = parsed.data;
  let touched = false;
  for (const key of ZENDESK_KEYS) {
    if (key in data) {
      delete data[key];
      touched = true;
    }
  }
  if (!touched) continue;
  // gray-matter's stringify preserves the body verbatim.
  const next = matter.stringify(parsed.content, data);
  writeFileSync(path, next, "utf-8");
  stripped += 1;
  console.log(`  stripped: ${project.name} (${path.replace(vaultPath, "<vault>")})`);
}
console.log(`\nStripped ${stripped} vault file(s).`);

console.log("\nDone.\n");
process.exit(0);
