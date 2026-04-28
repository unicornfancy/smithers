#!/usr/bin/env node
// Quick smoke test against a real vault. Run: node packages/vault/scripts/smoke.mjs <vaultPath>

import { createVault } from "../src/index.ts";

const vaultPath = process.argv[2] ?? "~/Documents/A8C Claude";
const vault = createVault({ vaultPath });

console.log("[vault] options:", vault.options);

const status = vault.status();
console.log("[vault] status:", {
  exists: status.exists,
  has_expected_layout: status.has_expected_layout,
  expected_paths_present: status.expected_paths.filter((p) => p.present).length,
  expected_paths_total: status.expected_paths.length,
});

const projects = await vault.listProjects();
console.log(`[vault] projects: ${projects.length}`);
for (const p of projects.slice(0, 5)) {
  console.log(
    `  - ${p.slug} (${p.kind}/${p.status}) "${p.name}" -> ${p.source.kind}`,
  );
}

const drafts = await vault.listDrafts();
console.log(`[vault] drafts: ${drafts.length}`);
for (const d of drafts.slice(0, 5)) {
  console.log(`  - [${d.state}] "${d.title}" id=${d.draft_id.slice(0, 24)}`);
}

const followUps = await vault.listFollowUps();
console.log(
  `[vault] follow-ups: ${followUps.active.length} active, ${followUps.resolved.length} resolved`,
);
for (const f of followUps.active.slice(0, 3)) {
  console.log(`  - [${f.status}] ${f.project} :: ${f.task.slice(0, 60)}`);
}

const daily = await vault.listDailyNotes();
console.log(`[vault] daily notes: ${daily.length} (latest: ${daily.at(-1)?.date ?? "none"})`);

const today = await vault.readTodayNote();
console.log(`[vault] today: ${today ? `${today.body.length} bytes @ ${today.modified_at}` : "(none)"}`);

const styleGuide = await vault.readStyleGuide();
console.log(`[vault] style guide: ${styleGuide ? styleGuide.filename : "(none)"}`);

const workingWith = await vault.readWorkingWith();
console.log(`[vault] working with: ${workingWith ? workingWith.filename : "(none)"}`);
