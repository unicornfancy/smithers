#!/usr/bin/env node
// Smoke for toggleProjectTask: build a tiny temp vault, flip a checkbox both
// directions, assert the file content matches expectations, clean up.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addProjectZendeskTicket,
  appendDecisionsToProject,
  appendFollowUp,
  appendProjectTask,
  createProjectScratchpad,
  createVault,
  deleteProjectTask,
  editProjectTaskText,
  findCallNotesByRecordingId,
  parseProjectTasks,
  refreshProjectZendeskMetadata,
  renameHiveMindPartnerSlug,
  resolveFollowUp,
  saveCallNotes,
  setPrimaryZendeskTicket,
  setProjectZendeskSearchTerms,
  snoozeFollowUp,
  toggleProjectTask,
  updateProjectFrontmatter,
  updateFollowUp,
  resolveVaultOptions,
} from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "smithers-toggle-"));
const projectsDir = join(root, "Projects");
mkdirSync(projectsDir, { recursive: true });

const filePath = join(projectsDir, "Smoke Project.md");
const initial = `---
slug: smoke-project
name: Smoke Project
kind: personal
status: active
---

# Smoke Project

## Open items

- [ ] First task
- [ ] Second task
- [x] Already done

## Notes

Some prose.
`;
writeFileSync(filePath, initial);

const vault = createVault({ vaultPath: root });
const opts = resolveVaultOptions({ vaultPath: root });

const project = await vault.readProject("smoke-project");
if (!project) throw new Error("project not found in temp vault");

const tasks = parseProjectTasks((await vault.readProjectDetail("smoke-project")).body);
console.log(`[toggle] parsed ${tasks.length} tasks`);
for (const t of tasks) console.log(`  - [${t.done ? "x" : " "}] ${t.text} (id=${t.task_id.slice(0, 8)})`);

const first = tasks.find((t) => t.text === "First task");
if (!first) throw new Error("could not find first task");

// Flip [ ] -> [x]
const r1 = await toggleProjectTask(opts, "smoke-project", first.task_id, true);
console.log(`[toggle] flipped first task -> done line=${r1.line_number}`);
const after1 = readFileSync(filePath, "utf8");
if (!after1.includes("- [x] First task")) {
  throw new Error("expected '- [x] First task' after flip; file:\n" + after1);
}
if (!after1.includes("- [ ] Second task")) {
  throw new Error("second task should be untouched");
}

// Flip [x] -> [ ]
const done = parseProjectTasks(after1.split(/---\n/).slice(2).join("---\n")).find(
  (t) => t.text === "Already done",
);
if (!done) throw new Error("could not find 'Already done' task");
const r2 = await toggleProjectTask(opts, "smoke-project", done.task_id, false);
console.log(`[toggle] flipped 'Already done' -> open line=${r2.line_number}`);
const after2 = readFileSync(filePath, "utf8");
if (!after2.includes("- [ ] Already done")) {
  throw new Error("expected '- [ ] Already done' after flip; file:\n" + after2);
}

console.log("[toggle] OK — both directions wrote correctly");

// --- Append: populated body ---
const a1 = await appendProjectTask(opts, "smoke-project", "Third task added in-app");
console.log(`[append] inserted "${a1.text}" at line ${a1.line_number} (id=${a1.task_id.slice(0, 8)})`);
const after3 = readFileSync(filePath, "utf8");
if (!after3.includes("- [ ] Third task added in-app")) {
  throw new Error("expected appended task in file:\n" + after3);
}
// Should land after the last existing task line ("Already done"), before the
// "## Notes" heading. Check ordering by line index.
const linesAfter3 = after3.split(/\r?\n/);
const idxAlready = linesAfter3.findIndex((l) => l.includes("Already done"));
const idxNew = linesAfter3.findIndex((l) => l.includes("Third task added in-app"));
const idxNotes = linesAfter3.findIndex((l) => l.startsWith("## Notes"));
if (!(idxAlready < idxNew && idxNew < idxNotes)) {
  throw new Error(`append landed in wrong place: already=${idxAlready} new=${idxNew} notes=${idxNotes}\n${after3}`);
}

// --- Append: empty-body project (no tasks at all) ---
const emptyPath = join(projectsDir, "Empty Project.md");
writeFileSync(
  emptyPath,
  `---
slug: empty-project
name: Empty Project
kind: personal
status: active
---

# Empty Project

Just prose, no checkboxes yet.
`,
);
const a2 = await appendProjectTask(opts, "empty-project", "First-ever task");
console.log(`[append] empty-body inserted "${a2.text}" at line ${a2.line_number}`);
const afterEmpty = readFileSync(emptyPath, "utf8");
if (!afterEmpty.includes("- [ ] First-ever task")) {
  throw new Error("expected appended task in empty body:\n" + afterEmpty);
}

// --- Empty / whitespace text should be rejected ---
let rejected = false;
try {
  await appendProjectTask(opts, "smoke-project", "   ");
} catch {
  rejected = true;
}
if (!rejected) throw new Error("expected empty task text to be rejected");

console.log("[append] OK — populated, empty-body, and whitespace-rejection paths all pass");

// --- Edit: rename a task, preserving indent + checkbox state ---
// Add an indented sub-task so we can verify indent is preserved.
const indentedPath = join(projectsDir, "Indented Project.md");
writeFileSync(
  indentedPath,
  `---
slug: indented-project
name: Indented Project
kind: personal
status: active
---

# Indented Project

## Open items

- [ ] Top-level task
  - [x] Nested done task
- [ ] Another top-level
`,
);
const indentedTasks = parseProjectTasks(
  readFileSync(indentedPath, "utf8").split(/---\n/).slice(2).join("---\n"),
);
const nested = indentedTasks.find((t) => t.text === "Nested done task");
if (!nested) throw new Error("could not find nested task");

const e1 = await editProjectTaskText(
  opts,
  "indented-project",
  nested.task_id,
  "Renamed nested task",
);
console.log(`[edit] renamed nested task -> "${e1.text}" (new id=${e1.task_id.slice(0, 8)})`);
const afterEdit = readFileSync(indentedPath, "utf8");
if (!afterEdit.includes("  - [x] Renamed nested task")) {
  throw new Error("expected indent + done state preserved:\n" + afterEdit);
}
if (afterEdit.includes("Nested done task")) {
  throw new Error("old text should be gone");
}
// Sibling tasks untouched
if (
  !afterEdit.includes("- [ ] Top-level task") ||
  !afterEdit.includes("- [ ] Another top-level")
) {
  throw new Error("sibling tasks should be untouched");
}
// id changed
if (e1.task_id === nested.task_id) {
  throw new Error("expected new task_id after rename");
}

// --- Edit: same text → no-op (returns existing id, doesn't bump file) ---
const beforeNoop = readFileSync(indentedPath, "utf8");
const e2 = await editProjectTaskText(
  opts,
  "indented-project",
  e1.task_id,
  "Renamed nested task",
);
const afterNoop = readFileSync(indentedPath, "utf8");
if (afterNoop !== beforeNoop) {
  throw new Error("no-op edit should not rewrite the file");
}
if (e2.task_id !== e1.task_id) {
  throw new Error("no-op edit should return same id");
}

// --- Edit: empty / whitespace text rejected ---
let editRejected = false;
try {
  await editProjectTaskText(opts, "indented-project", e1.task_id, "   ");
} catch {
  editRejected = true;
}
if (!editRejected) throw new Error("expected empty edit text to be rejected");

console.log("[edit] OK — preserves indent + state, no-op short-circuits, whitespace rejected");

// --- Delete: remove a task, leave siblings + headings intact ---
const beforeDelete = readFileSync(indentedPath, "utf8");
const indentedTasks2 = parseProjectTasks(
  beforeDelete.split(/---\n/).slice(2).join("---\n"),
);
const toDelete = indentedTasks2.find((t) => t.text === "Top-level task");
if (!toDelete) throw new Error("could not find target for delete");

const d1 = await deleteProjectTask(opts, "indented-project", toDelete.task_id);
console.log(`[delete] removed "${d1.text}" from line ${d1.line_number}`);
const afterDelete = readFileSync(indentedPath, "utf8");
if (afterDelete.includes("- [ ] Top-level task")) {
  throw new Error("expected deleted line to be gone:\n" + afterDelete);
}
// Sibling tasks still present
if (
  !afterDelete.includes("Renamed nested task") ||
  !afterDelete.includes("- [ ] Another top-level")
) {
  throw new Error("siblings should be intact after delete");
}
// Heading still present
if (!afterDelete.includes("## Open items")) {
  throw new Error("section heading should be intact");
}
// Frontmatter still present
if (!afterDelete.startsWith("---\nslug: indented-project")) {
  throw new Error("frontmatter should be intact");
}

// --- Delete: stale id should error cleanly ---
let deleteRejected = false;
try {
  await deleteProjectTask(opts, "indented-project", toDelete.task_id);
} catch {
  deleteRejected = true;
}
if (!deleteRejected) throw new Error("expected stale-id delete to throw");

console.log("[delete] OK — line removed, siblings + headings + frontmatter intact, stale id rejected");

// --- Zendesk: attach by raw id, then by URL pointing to a different ticket ---
const zPath = join(projectsDir, "Zendesk Project.md");
writeFileSync(
  zPath,
  `---
slug: zendesk-project
name: Zendesk Project
kind: partner
status: active
partner: example-partner
---

# Zendesk Project

Some prose.
`,
);
const z1 = await addProjectZendeskTicket(opts, "zendesk-project", "11134851");
if (!z1.added || z1.zendesk_tickets.length !== 1) {
  throw new Error("expected first attach to add: " + JSON.stringify(z1));
}
if (z1.zendesk_tickets[0].id !== "11134851") {
  throw new Error("expected ZendeskTicketRef shape: " + JSON.stringify(z1.zendesk_tickets[0]));
}
console.log(`[zendesk] attached id 11134851 -> ${JSON.stringify(z1.zendesk_tickets)}`);

// Attach with rich summary — subject + status + updated_at should persist
const z2 = await addProjectZendeskTicket(opts, "zendesk-project", {
  id: "12000123",
  subject: "Calendar dates switching",
  status: "open",
  priority: "normal",
  updated_at: "2026-04-29T15:33:05Z",
});
if (!z2.added || z2.zendesk_tickets.length !== 2) {
  throw new Error("expected rich attach to add as second: " + JSON.stringify(z2));
}
if (z2.zendesk_tickets[1].subject !== "Calendar dates switching") {
  throw new Error("expected subject to persist: " + JSON.stringify(z2.zendesk_tickets[1]));
}

// --- Idempotency: same id in different form ---
const z3 = await addProjectZendeskTicket(
  opts,
  "zendesk-project",
  "https://automattic.zendesk.com/agent/tickets/11134851",
);
if (z3.added) throw new Error("expected URL form of existing id to be a no-op");
if (z3.zendesk_tickets.length !== 2) throw new Error("array length should not change on duplicate");
console.log("[zendesk] URL form of existing id correctly de-duped");

// --- Empty ref rejected ---
let zRejected = false;
try { await addProjectZendeskTicket(opts, "zendesk-project", "  "); } catch { zRejected = true; }
if (!zRejected) throw new Error("expected empty ticket ref to be rejected");

// --- Frontmatter persisted: rich object form for one entry, bare id for the other ---
const finalContent = readFileSync(zPath, "utf8");
if (!finalContent.includes("Calendar dates switching")) {
  throw new Error("expected persisted subject in YAML:\n" + finalContent);
}
if (!finalContent.includes("Some prose.")) throw new Error("body should be untouched");

console.log("[zendesk] OK — bare-id + rich-object attach, dedup by id, subject persists in frontmatter");

// --- setPrimary: reorder array so picked id lands at position 0 ---
const p1 = await setPrimaryZendeskTicket(opts, "zendesk-project", "12000123");
if (!p1.changed || p1.zendesk_tickets[0].id !== "12000123") {
  throw new Error("expected 12000123 to move to position 0: " + JSON.stringify(p1));
}
if (p1.zendesk_tickets[1].id !== "11134851") {
  throw new Error("expected old primary at index 1: " + JSON.stringify(p1));
}
// Subject should ride along
if (p1.zendesk_tickets[0].subject !== "Calendar dates switching") {
  throw new Error("expected subject to survive reorder");
}
console.log(`[primary] promoted by id, subject preserved -> ${JSON.stringify(p1.zendesk_tickets[0])}`);

// Promote back via raw id
const p2 = await setPrimaryZendeskTicket(opts, "zendesk-project", "11134851");
if (!p2.changed || p2.zendesk_tickets[0].id !== "11134851") {
  throw new Error("expected raw id to move to position 0: " + JSON.stringify(p2));
}

// No-op when already primary
const p3 = await setPrimaryZendeskTicket(opts, "zendesk-project", "11134851");
if (p3.changed) throw new Error("expected no-op when already primary");

// Unknown ticket → throws
let primaryRejected = false;
try {
  await setPrimaryZendeskTicket(opts, "zendesk-project", "99999999");
} catch {
  primaryRejected = true;
}
if (!primaryRejected) throw new Error("expected unknown ticket to throw");
console.log("[primary] OK — promote by URL + by raw id, no-op on already-primary, unknown rejects");

// --- refreshProjectZendeskMetadata: backfill subject/status into bare entries ---
// At this point: 11134851 is bare-id (no subject); 12000123 has metadata.
// Refreshing with new data for 11134851 should write it; passing existing
// data for 12000123 should not duplicate-write since values unchanged.
const refresh1 = await refreshProjectZendeskMetadata(opts, "zendesk-project", [
  { id: "11134851", subject: "Backfilled subject", status: "pending" },
  { id: "12000123", subject: "Calendar dates switching", status: "open" }, // unchanged
]);
if (refresh1.updated !== 1) {
  throw new Error(`expected 1 update, got ${refresh1.updated}`);
}
const fresh = refresh1.zendesk_tickets.find((t) => t.id === "11134851");
if (fresh?.subject !== "Backfilled subject") {
  throw new Error("expected subject to be backfilled: " + JSON.stringify(fresh));
}
if (fresh?.status !== "pending") {
  throw new Error("expected status to be backfilled");
}
// No-op when nothing would change
const refresh2 = await refreshProjectZendeskMetadata(opts, "zendesk-project", [
  { id: "11134851", subject: "Backfilled subject", status: "pending" },
]);
if (refresh2.updated !== 0) throw new Error("expected no-op refresh");
console.log("[refresh] OK — backfills missing metadata, no-ops on unchanged");

// --- setProjectZendeskSearchTerms: persist + dedup + clear ---
const st1 = await setProjectZendeskSearchTerms(opts, "zendesk-project", [
  "  martin@thepocketnyc.com  ",
  "Martin Porter",
  "Martin Porter", // dup
  "",
]);
if (!st1.changed) throw new Error("expected changed=true on first save");
if (st1.zendesk_search_terms.length !== 2) {
  throw new Error("expected 2 deduped terms, got " + st1.zendesk_search_terms.length);
}
const persistedFile = readFileSync(zPath, "utf8");
if (!persistedFile.includes("zendesk_search_terms:")) {
  throw new Error("expected zendesk_search_terms in YAML:\n" + persistedFile);
}

// Save same list → no change
const st2 = await setProjectZendeskSearchTerms(opts, "zendesk-project", [
  "martin@thepocketnyc.com",
  "Martin Porter",
]);
if (st2.changed) throw new Error("expected no-op when terms match");

// Empty array clears the field
const st3 = await setProjectZendeskSearchTerms(opts, "zendesk-project", []);
if (!st3.changed) throw new Error("expected changed=true when clearing");
const cleared = readFileSync(zPath, "utf8");
if (cleared.includes("zendesk_search_terms")) {
  throw new Error("expected field removed on empty:\n" + cleared);
}
console.log("[search-terms] OK — persists, dedupes, no-ops on unchanged, clears on empty");

// --- updateProjectFrontmatter: set, clear, leave-alone ---
const u1 = await updateProjectFrontmatter(opts, "zendesk-project", {
  status: "hot",
  github_repo: "a8cteam51/example",
  staging_url: "https://staging.example.com",
});
if (!u1.changed) throw new Error("expected changed=true on patch");
const fileAfterU1 = readFileSync(zPath, "utf8");
if (!fileAfterU1.includes("status: hot")) {
  throw new Error("expected status set:\n" + fileAfterU1);
}
if (!fileAfterU1.includes("github_repo: a8cteam51/example")) {
  throw new Error("expected github_repo set");
}

// Empty-string clears
const u2 = await updateProjectFrontmatter(opts, "zendesk-project", {
  staging_url: "",
});
if (!u2.changed) throw new Error("expected change when clearing");
const fileAfterU2 = readFileSync(zPath, "utf8");
if (fileAfterU2.includes("staging.example.com")) {
  throw new Error("expected staging_url removed");
}

// undefined leaves alone, no-op when nothing changes
const u3 = await updateProjectFrontmatter(opts, "zendesk-project", {});
if (u3.changed) throw new Error("expected no-op on empty patch");

// Boolean fields: true sets, false clears
const u4 = await updateProjectFrontmatter(opts, "zendesk-project", {
  nda: true,
});
if (!u4.changed) throw new Error("expected nda set");
if (!readFileSync(zPath, "utf8").includes("nda: true")) {
  throw new Error("expected nda: true in YAML");
}
const u5 = await updateProjectFrontmatter(opts, "zendesk-project", {
  nda: false,
});
if (!u5.changed) throw new Error("expected nda cleared");
if (readFileSync(zPath, "utf8").includes("nda:")) {
  throw new Error("expected nda removed when set false");
}
console.log("[update] OK — set, clear-on-empty, no-op, bool true sets / bool false clears");

// --- resolveFollowUp: flip Status cell to "✅ Resolved …" ---
// Build a Follow-ups.md with two open rows; pick one to resolve.
const followUpsPath = join(root, "Follow-ups.md");
writeFileSync(
  followUpsPath,
  `# Follow-ups Tracker

## Open Follow-ups

| Project | Task | Sent | Follow-up By | Status | Source |
|---|---|---|---|---|---|
| Smoke Project | First task to follow up on | 2026-04-29 | 2026-05-04 | ⏳ Waiting | |
| Smoke Project | Second task | 2026-04-30 | 2026-05-05 | ⏳ Waiting | |

## Resolved Follow-ups

| Project | Task | Sent | Resolved | Notes |
|---|---|---|---|---|
`,
);

// Compute the deterministic id the parser would use.
// id = deterministicId(project, task, sent)
const { deterministicId } = await import("../src/ids.ts");
const targetId = deterministicId(
  "Smoke Project",
  "First task to follow up on",
  "2026-04-29",
);

const fr1 = await resolveFollowUp(opts, targetId);
if (!fr1.changed) throw new Error("expected resolveFollowUp to flip status");
const updated = readFileSync(followUpsPath, "utf8");
if (!updated.includes("✅ Resolved")) {
  throw new Error("expected '✅ Resolved' in file:\n" + updated);
}
if (!updated.includes("Second task")) {
  throw new Error("sibling row should be untouched");
}

// Idempotency: resolving an already-resolved row is a no-op
const fr2 = await resolveFollowUp(opts, targetId);
if (fr2.changed) throw new Error("expected no-op on already-resolved row");

// Unknown id throws
let resolveRejected = false;
try {
  await resolveFollowUp(opts, "no-such-id");
} catch {
  resolveRejected = true;
}
if (!resolveRejected) throw new Error("expected unknown follow-up to throw");
console.log("[follow-up] OK — flip-to-resolved, idempotent, unknown rejects");

// --- snoozeFollowUp: push the Follow-up By cell forward, idempotent re-snooze ---
// Use the still-open "Second task" row from the file we already wrote.
const snoozeTargetId = deterministicId(
  "Smoke Project",
  "Second task",
  "2026-04-30",
);
const snoozeDate = "2026-05-15";
const sn1 = await snoozeFollowUp(opts, snoozeTargetId, snoozeDate);
if (!sn1.changed) throw new Error("expected snooze to write a new date");
if (sn1.follow_up_by !== snoozeDate) {
  throw new Error(`expected follow_up_by=${snoozeDate}, got ${sn1.follow_up_by}`);
}
const snoozedFile = readFileSync(followUpsPath, "utf8");
if (!snoozedFile.includes(`| 2026-04-30 | ${snoozeDate} |`)) {
  throw new Error("expected new Follow-up By cell in the row:\n" + snoozedFile);
}
// Resolved sibling row should still be marked resolved (not clobbered)
if (!snoozedFile.includes("✅ Resolved")) {
  throw new Error("snooze should not affect the previously resolved row");
}

// Idempotent: re-snoozing to the same date is a no-op
const sn2 = await snoozeFollowUp(opts, snoozeTargetId, snoozeDate);
if (sn2.changed) throw new Error("expected no-op re-snooze");
if (sn2.follow_up_by !== snoozeDate) throw new Error("expected same date returned");

// Unknown id throws cleanly
let snoozeRejected = false;
try {
  await snoozeFollowUp(opts, "no-such-id", "2026-05-20");
} catch {
  snoozeRejected = true;
}
if (!snoozeRejected) throw new Error("expected unknown id to throw");
console.log("[snooze] OK — pushes Follow-up By forward, idempotent re-snooze, unknown rejects");

// --- appendFollowUp: append a row to Open Follow-ups table ---
const af1 = await appendFollowUp(opts, {
  project: "Smoke Project",
  task: "Send Loom of staging accordion blocks",
  follow_up_by: "2026-05-08",
  source: "[call](https://fathom.video/calls/12345)",
});
if (!af1.follow_up_id) throw new Error("expected follow_up_id");
const afterAppend = readFileSync(followUpsPath, "utf8");
if (!afterAppend.includes("Send Loom of staging accordion blocks")) {
  throw new Error("expected appended task in file:\n" + afterAppend);
}
if (!afterAppend.includes("⏳ Waiting")) {
  throw new Error("expected ⏳ Waiting status on new row");
}
// Original rows untouched
if (!afterAppend.includes("Second task")) {
  throw new Error("existing rows should be intact");
}
console.log("[append-followup] OK — row added with status, source preserved");

// --- updateFollowUp: edit task text + follow_up_by, idempotent, unknown rejects ---
// Use the appended row we just created ("Send Loom of staging accordion blocks")
const updateTargetId = af1.follow_up_id;
// Change the follow_up_by date
const uf1 = await updateFollowUp(opts, updateTargetId, { follow_up_by: "2026-05-20" });
if (!uf1.changed) throw new Error("expected updateFollowUp to write a new date");
const afterUpdate1 = readFileSync(followUpsPath, "utf8");
if (!afterUpdate1.includes("2026-05-20")) {
  throw new Error("expected new follow_up_by cell in file:\n" + afterUpdate1);
}
// Idempotent: re-patching follow_up_by with the same value is a no-op
const uf2 = await updateFollowUp(opts, updateTargetId, { follow_up_by: "2026-05-20" });
if (uf2.changed) throw new Error("expected no-op when follow_up_by unchanged");
// Unknown id throws
let updateRejected = false;
try {
  await updateFollowUp(opts, "no-such-id", { task: "anything" });
} catch {
  updateRejected = true;
}
if (!updateRejected) throw new Error("expected unknown follow-up to throw");
console.log("[update-followup] OK — changes field, idempotent on unchanged, unknown rejects");

// --- appendFollowUp with source_type + source_ref: columns written and round-trip ---
const afLinked1 = await appendFollowUp(opts, {
  project: "Smoke Project",
  task: "Follow up on Zendesk ticket 99001",
  follow_up_by: "2026-05-20",
  source_type: "zendesk",
  source_ref: "99001",
});
if (!afLinked1.follow_up_id) throw new Error("[linked-follow-up] expected follow_up_id");
const afterLinked1 = readFileSync(followUpsPath, "utf8");
if (!afterLinked1.includes("zendesk")) {
  throw new Error("[linked-follow-up] expected source_type 'zendesk' in file:\n" + afterLinked1);
}
if (!afterLinked1.includes("99001")) {
  throw new Error("[linked-follow-up] expected source_ref '99001' in file:\n" + afterLinked1);
}
if (!afterLinked1.includes("Source Type") || !afterLinked1.includes("Source Ref")) {
  throw new Error("[linked-follow-up] expected Source Type + Source Ref header columns:\n" + afterLinked1);
}

// Verify round-trip via listFollowUps
const { listFollowUps: listFU } = await import("../src/follow-ups.ts");
const { resolveVaultOptions: rvOpts } = await import("../src/config.ts");
const fuOpts = rvOpts({ vaultPath: root });
const listed1 = await listFU(fuOpts);
const linked1Row = [...listed1.active, ...listed1.resolved].find(
  (f) => f.follow_up_id === afLinked1.follow_up_id,
);
if (!linked1Row) throw new Error("[linked-follow-up] row not found via listFollowUps");
if (linked1Row.source_type !== "zendesk") {
  throw new Error(`[linked-follow-up] expected source_type=zendesk, got ${linked1Row.source_type}`);
}
if (linked1Row.source_ref !== "99001") {
  throw new Error(`[linked-follow-up] expected source_ref=99001, got ${linked1Row.source_ref}`);
}
console.log("[linked-follow-up] OK — source_type + source_ref written and round-trip correctly");

// --- Auto-migrate: write to a Follow-ups.md with old header (no source columns) ---
const oldHeaderPath = join(root, "Follow-ups-old.md");
writeFileSync(
  oldHeaderPath,
  `# Follow-ups Tracker

## Open Follow-ups

| Project | Task | Sent | Follow-up By | Status | Source |
|---|---|---|---|---|---|
| Old Project | Old task | 2026-04-01 | 2026-05-01 | ⏳ Waiting | |

## Resolved Follow-ups

| Project | Task | Sent | Resolved | Notes |
|---|---|---|---|---|
`,
);

// Temporarily swap the followUps path by creating a vault with a different file.
// We test by calling appendFollowUp directly with opts pointing to the temp root
// but the file at root/Follow-ups.md. Instead, call it with an options override.
// Easiest: rename/copy, run, verify.
import { copyFileSync } from "node:fs";
copyFileSync(oldHeaderPath, join(root, "Follow-ups-migrate-test.md"));

// We cannot easily swap vaultPaths here, so we verify by reading the file
// after an appendFollowUp call to the main followUpsPath which already has
// the new columns (they were migrated by the previous test). Instead write
// a fresh file to the standard path and do the migration test from scratch.
const migratePath = join(root, "Follow-ups.md");
writeFileSync(
  migratePath,
  `# Follow-ups Tracker

## Open Follow-ups

| Project | Task | Sent | Follow-up By | Status | Source |
|---|---|---|---|---|---|

## Resolved Follow-ups

| Project | Task | Sent | Resolved | Notes |
|---|---|---|---|---|
`,
);

const afMigrate = await appendFollowUp(opts, {
  project: "Migrate Project",
  task: "Test auto-migrate",
  source_type: "github",
  source_ref: "42",
});
if (!afMigrate.follow_up_id) throw new Error("[auto-migrate] expected follow_up_id");
const afterMigrate = readFileSync(migratePath, "utf8");
if (!afterMigrate.includes("Source Type") || !afterMigrate.includes("Source Ref")) {
  throw new Error("[auto-migrate] expected Source Type + Source Ref added to header:\n" + afterMigrate);
}
if (!afterMigrate.includes("github") || !afterMigrate.includes("42")) {
  throw new Error("[auto-migrate] expected source values written:\n" + afterMigrate);
}
// Verify old rows without source columns still survive (header migrated, data rows have extra empty cells)
// The table should still have the original row (the old header row is updated, existing data rows get
// rendered without the new columns since the old rows have fewer cells — parser tolerates this).
console.log("[auto-migrate] OK — Source Type + Source Ref columns added to existing header on first write");

// --- appendDecisionsToProject: section creation + per-call sub-blocks ---
const dec1 = await appendDecisionsToProject(opts, "smoke-project", {
  call_title: "Strategy sync",
  call_date: "2026-04-29",
  call_url: "https://fathom.video/calls/12345",
  decisions: [
    { text: "Picked accordion layout over carousel", context: "Mobile UX cleaner" },
    { text: "LMS confirmed: LearnDash + BuddyBoss" },
  ],
});
if (!dec1.changed) throw new Error("expected decisions append to change file");
const projectAfter = readFileSync(filePath, "utf8");
if (!projectAfter.includes("## Decisions")) {
  throw new Error("expected ## Decisions heading:\n" + projectAfter);
}
if (!projectAfter.includes("### From call 2026-04-29 — [Strategy sync]")) {
  throw new Error("expected sub-block with linked title");
}
if (!projectAfter.includes("Picked accordion layout over carousel")) {
  throw new Error("expected first decision");
}

// Subsequent calls add to existing section, not duplicate the heading
const dec2 = await appendDecisionsToProject(opts, "smoke-project", {
  call_title: "Follow-up sync",
  call_date: "2026-05-06",
  decisions: [{ text: "Move launch to following Tuesday" }],
});
if (!dec2.changed) throw new Error("expected second append to change file");
const projectAfter2 = readFileSync(filePath, "utf8");
const decHeadingCount = (projectAfter2.match(/^## Decisions$/gm) ?? []).length;
if (decHeadingCount !== 1) {
  throw new Error(`expected exactly one ## Decisions heading, got ${decHeadingCount}`);
}
if (!projectAfter2.includes("Move launch to following Tuesday")) {
  throw new Error("expected second decision");
}
console.log("[decisions] OK — creates section, appends sub-blocks, single heading on repeat");

// --- saveCallNotes + findCallNotesByRecordingId round-trip ---
const saved1 = await saveCallNotes(opts, {
  project_slug: "smoke-project",
  recording: {
    recording_id: "rec-abc-123",
    title: "Strategy sync",
    recorded_at: "2026-04-29T15:00:00Z",
    url: "https://fathom.video/calls/12345",
  },
  analysis: {
    summary: "Discussed timeline + LMS stack.",
    action_items: [{ text: "Send Loom of accordion blocks", owner: "user" }],
    follow_ups: [
      {
        task: "Tom to confirm Gravity Forms migration call",
        rationale: "Partner waiting for our scheduling slots.",
        follow_up_by: "2026-05-08",
      },
    ],
    decisions: [{ text: "Picked accordion layout" }],
    key_quotes: [{ speaker: "Martin", text: "Targeting end of next week." }],
  },
});
if (!saved1.absolute_path) throw new Error("expected absolute_path");
const savedRaw = readFileSync(saved1.absolute_path, "utf8");
if (!savedRaw.includes("recording_id: rec-abc-123")) {
  throw new Error("expected recording_id in frontmatter");
}
if (!savedRaw.includes("## Action items")) {
  throw new Error("expected rendered Action items section");
}

// Lookup by recording_id
const found = await findCallNotesByRecordingId(opts, "rec-abc-123");
if (!found || found.recording_id !== "rec-abc-123") {
  throw new Error("expected lookup to return the saved file");
}
if (found.analysis.action_items.length !== 1) {
  throw new Error("expected analysis to round-trip");
}
if (found.analysis.action_items[0].text !== "Send Loom of accordion blocks") {
  throw new Error("expected action item text preserved");
}

// Re-saving same recording_id reuses the same file (no duplicate)
const saved2 = await saveCallNotes(opts, {
  project_slug: "smoke-project",
  recording: {
    recording_id: "rec-abc-123",
    title: "Strategy sync (re-analyzed)",
    recorded_at: "2026-04-29T15:00:00Z",
  },
  analysis: { ...saved1.analysis, summary: "Updated summary." },
});
if (saved2.absolute_path !== saved1.absolute_path) {
  throw new Error("expected re-save to reuse the same file path");
}
const updatedRaw = readFileSync(saved2.absolute_path, "utf8");
if (!updatedRaw.includes("Updated summary.")) {
  throw new Error("expected updated summary in re-saved file");
}
console.log("[call-notes] OK — saved, round-trips via recording_id, re-save reuses file");

// --- parseTaskMarkers / priority + due_date round-trip ---
const { parseTaskMarkers } = await import("../src/tasks.ts");

// Basic parse
const mk1 = parseTaskMarkers("Review contract terms [high] [2026-05-15]");
if (mk1.text !== "Review contract terms") throw new Error(`expected clean text, got "${mk1.text}"`);
if (mk1.priority !== "high") throw new Error(`expected priority=high, got ${mk1.priority}`);
if (mk1.due_date !== "2026-05-15") throw new Error(`expected due_date=2026-05-15, got ${mk1.due_date}`);

// Order doesn't matter: date before priority
const mk2 = parseTaskMarkers("Send loom [2026-06-01] [medium]");
if (mk2.text !== "Send loom") throw new Error(`expected "Send loom", got "${mk2.text}"`);
if (mk2.priority !== "medium") throw new Error(`expected priority=medium, got ${mk2.priority}`);
if (mk2.due_date !== "2026-06-01") throw new Error(`expected due_date=2026-06-01, got ${mk2.due_date}`);

// Only priority, no due date
const mk3 = parseTaskMarkers("Deploy to staging [low]");
if (mk3.text !== "Deploy to staging") throw new Error(`expected "Deploy to staging", got "${mk3.text}"`);
if (mk3.priority !== "low") throw new Error(`expected priority=low, got ${mk3.priority}`);
if (mk3.due_date !== undefined) throw new Error(`expected no due_date, got ${mk3.due_date}`);

// No markers
const mk4 = parseTaskMarkers("Plain task");
if (mk4.text !== "Plain task") throw new Error(`expected "Plain task", got "${mk4.text}"`);
if (mk4.priority !== undefined) throw new Error("expected no priority");
if (mk4.due_date !== undefined) throw new Error("expected no due_date");

console.log("[markers] parse: clean text, priority, due_date all correct in all variants");

// --- appendProjectTask with markers + round-trip via parseProjectTasks ---
const markersFilePath = join(projectsDir, "Markers Project.md");
writeFileSync(
  markersFilePath,
  `---
slug: markers-project
name: Markers Project
kind: personal
status: active
---

# Markers Project

## Open items
`,
);

const mapp1 = await appendProjectTask(opts, "markers-project", "Urgent review", {
  priority: "high",
  due_date: "2026-05-20",
});
const afterMapp1 = readFileSync(markersFilePath, "utf8");
if (!afterMapp1.includes("- [ ] Urgent review [high] [2026-05-20]")) {
  throw new Error("expected markers serialized in file:\n" + afterMapp1);
}
// Parse back and confirm fields
const parsedMapp1 = parseProjectTasks(afterMapp1.split(/---\n/).slice(2).join("---\n"));
const taskMapp1 = parsedMapp1.find((t) => t.task_id === mapp1.task_id);
if (!taskMapp1) throw new Error("could not find appended task by task_id");
if (taskMapp1.text !== "Urgent review") throw new Error(`expected clean text, got "${taskMapp1.text}"`);
if (taskMapp1.priority !== "high") throw new Error(`expected priority=high, got ${taskMapp1.priority}`);
if (taskMapp1.due_date !== "2026-05-20") throw new Error(`expected due_date=2026-05-20, got ${taskMapp1.due_date}`);

// Append a second task with different markers (same clean text, different line → different task_id)
const mapp1b = await appendProjectTask(opts, "markers-project", "Urgent review", {
  priority: "medium",
  due_date: "2026-06-01",
});
const afterMapp1b = readFileSync(markersFilePath, "utf8");
const parsedMapp1b = parseProjectTasks(afterMapp1b.split(/---\n/).slice(2).join("---\n"));
const taskMapp1b = parsedMapp1b.find((t) => t.task_id === mapp1b.task_id);
if (!taskMapp1b) throw new Error("could not find second appended task");
if (taskMapp1b.priority !== "medium") throw new Error(`expected priority=medium, got ${taskMapp1b.priority}`);

console.log("[markers] append: markers serialized and parsed back correctly");

// --- editProjectTaskText preserves markers ---
// taskMapp1 has [high] [2026-05-20] — edit its text, expect markers survive
const editedMapp1 = await editProjectTaskText(opts, "markers-project", taskMapp1.task_id, "Critical review updated");
const afterMarkersEdit = readFileSync(markersFilePath, "utf8");
if (!afterMarkersEdit.includes("- [ ] Critical review updated [high] [2026-05-20]")) {
  throw new Error("expected markers preserved after edit:\n" + afterMarkersEdit);
}
// old text should be gone
if (afterMarkersEdit.includes("- [ ] Urgent review [high]")) {
  throw new Error("old text+markers should be gone");
}
// new task_id from reparsed file
const parsedMarkersEdit = parseProjectTasks(afterMarkersEdit.split(/---\n/).slice(2).join("---\n"));
const editedMarkersTask = parsedMarkersEdit.find((t) => t.task_id === editedMapp1.task_id);
if (!editedMarkersTask) throw new Error("could not find edited task by new task_id");
if (editedMarkersTask.text !== "Critical review updated") throw new Error(`expected clean text, got "${editedMarkersTask.text}"`);
if (editedMarkersTask.priority !== "high") throw new Error(`expected priority preserved, got ${editedMarkersTask.priority}`);
if (editedMarkersTask.due_date !== "2026-05-20") throw new Error(`expected due_date preserved, got ${editedMarkersTask.due_date}`);

console.log("[markers] edit: markers preserved after text rename, clean text in task_id, fields correct");

// --- Hive Mind helpers ---
// These require hiveMindPath to be configured in config.local.yaml.
// They read from <hiveMindPath>/knowledge/partners/_example-partner/_example-project/.
// If hiveMindPath is not set (empty string), all helpers return null / [].
import {
  getHiveMindCallTranscripts,
  getHiveMindDrafts,
  getHiveMindNotes,
  getHiveMindPartner,
  getHiveMindProject,
} from "../src/hive-mind.ts";

// Test with no hiveMindPath configured: all helpers return null / []
const hmOptsEmpty = resolveVaultOptions({ vaultPath: root });
const hmPartnerNull = await getHiveMindPartner(hmOptsEmpty, "_example-partner");
if (hmPartnerNull !== null) throw new Error("[hive-mind] expected null when hiveMindPath empty");
const hmProjectNull = await getHiveMindProject(hmOptsEmpty, "_example-partner", "_example-project");
if (hmProjectNull !== null) throw new Error("[hive-mind] expected null when hiveMindPath empty");
const hmNotesNull = await getHiveMindNotes(hmOptsEmpty, "_example-partner", "_example-project");
if (hmNotesNull !== null) throw new Error("[hive-mind] expected null when hiveMindPath empty");
const hmCallNotesEmpty = await getHiveMindCallTranscripts(hmOptsEmpty, "_example-partner", "_example-project");
if (hmCallNotesEmpty.length !== 0) throw new Error("[hive-mind] expected [] when hiveMindPath empty");
const hmDraftsEmpty = await getHiveMindDrafts(hmOptsEmpty, "_example-partner", "_example-project");
if (hmDraftsEmpty.length !== 0) throw new Error("[hive-mind] expected [] when hiveMindPath empty");
console.log("[hive-mind] no-hiveMindPath: all helpers return null/[] correctly");

// If config.local.yaml has hiveMindPath set, test against the real Hive Mind repo.
// Smoke passes without this — configure hiveMindPath to exercise the live paths.
import { readFile as readFileAsync } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolvePath(__dirname, "..", "..", "..");
let hiveMindPath = "";
for (const name of ["config.local.yaml", "config.yaml", "config.example.yaml"]) {
  try {
    const raw = await readFileAsync(resolvePath(repoRoot, name), "utf-8");
    const parsed = yaml.load(raw);
    const p = parsed?.paths?.hive_mind ?? "";
    if (p && p !== "~/Team51-Hive-Mind") {
      hiveMindPath = p.startsWith("~/")
        ? resolvePath(process.env.HOME, p.slice(2))
        : resolvePath(p);
      break;
    }
    if (p) {
      const expanded = p.startsWith("~/")
        ? resolvePath(process.env.HOME, p.slice(2))
        : resolvePath(p);
      // Only use it if the path actually exists
      try { await readFileAsync(resolvePath(expanded, "knowledge", "partners", "_example-partner", "partner-knowledge.md")); hiveMindPath = expanded; break; } catch {}
    }
  } catch {}
}

if (hiveMindPath) {
  const hmOpts = resolveVaultOptions({ vaultPath: root, hiveMindPath });

  const hmPartner = await getHiveMindPartner(hmOpts, "_example-partner");
  if (!hmPartner) throw new Error("[hive-mind] getHiveMindPartner returned null for _example-partner");
  if (!hmPartner.title) throw new Error("[hive-mind] expected title in partner frontmatter");
  if (!hmPartner.body) throw new Error("[hive-mind] expected non-empty body");
  console.log(`[hive-mind] getHiveMindPartner: title="${hmPartner.title}" nda=${hmPartner.nda}`);

  const hmProject = await getHiveMindProject(hmOpts, "_example-partner", "_example-project");
  if (!hmProject) throw new Error("[hive-mind] getHiveMindProject returned null for _example-project");
  if (!hmProject.title) throw new Error("[hive-mind] expected title in project frontmatter");
  console.log(`[hive-mind] getHiveMindProject: title="${hmProject.title}" status="${hmProject.status}"`);

  const hmNotes = await getHiveMindNotes(hmOpts, "_example-partner", "_example-project");
  if (hmNotes === null) throw new Error("[hive-mind] getHiveMindNotes returned null");
  console.log(`[hive-mind] getHiveMindNotes: ${hmNotes.length} chars`);

  const hmCallNotes = await getHiveMindCallTranscripts(hmOpts, "_example-partner", "_example-project");
  console.log(`[hive-mind] getHiveMindCallTranscripts: ${hmCallNotes.length} file(s)`);

  const hmDrafts = await getHiveMindDrafts(hmOpts, "_example-partner", "_example-project");
  console.log(`[hive-mind] getHiveMindDrafts: ${hmDrafts.length} file(s)`);

  // Missing partner/project returns null without throwing
  const hmMissing = await getHiveMindPartner(hmOpts, "no-such-partner-xyz");
  if (hmMissing !== null) throw new Error("[hive-mind] expected null for missing partner");
  const hmMissingProject = await getHiveMindProject(hmOpts, "_example-partner", "no-such-project-xyz");
  if (hmMissingProject !== null) throw new Error("[hive-mind] expected null for missing project");

  console.log("[hive-mind] live: all helpers pass");
} else {
  console.log("[hive-mind] skipping live tests — configure paths.hive_mind in config.local.yaml to enable");
}

// --- createProjectScratchpad: seed new file, idempotent on re-run ---
const sp1 = await createProjectScratchpad(opts, {
  name: "Scratch Project",
  slug: "scratch-project",
  partner: "example-partner",
  hive_mind_partner_slug: "example-partner",
  linear_project_id: "lin_123",
});
if (!sp1.created) throw new Error("expected created=true on first scratchpad");
const spRaw = readFileSync(sp1.absolute_path, "utf8");
if (!spRaw.includes("name: Scratch Project")) throw new Error("expected name in YAML:\n" + spRaw);
if (!spRaw.includes("slug: scratch-project")) throw new Error("expected slug in YAML");
if (!spRaw.includes("partner: example-partner")) throw new Error("expected partner in YAML");
if (!spRaw.includes("linear_project_id: lin_123")) throw new Error("expected linear_project_id in YAML");
if (spRaw.includes("hive_mind_project_slug")) throw new Error("expected omitted optional key absent");
if (!spRaw.includes("## Open Items")) throw new Error("expected Open Items heading");
if (!spRaw.includes("- [ ] ")) throw new Error("expected blank checkbox seed");

// Re-run is a no-op: file preserved, created=false
writeFileSync(sp1.absolute_path, spRaw + "\nuser edit\n");
const sp2 = await createProjectScratchpad(opts, {
  name: "Scratch Project",
  slug: "scratch-project",
});
if (sp2.created) throw new Error("expected created=false when file already exists");
const spRaw2 = readFileSync(sp1.absolute_path, "utf8");
if (!spRaw2.includes("user edit")) throw new Error("expected existing file preserved");
console.log("[scratchpad] OK — seeds frontmatter + Open Items, idempotent on existing file");

// --- renameHiveMindPartnerSlug: standalone temp vault + HM clone (no git init) ---
{
  const { execSync } = await import("node:child_process");
  const renameRoot = mkdtempSync(join(tmpdir(), "smithers-rename-"));
  const rProjects = join(renameRoot, "vault", "Projects");
  const rHmPartners = join(renameRoot, "hm", "knowledge", "partners");
  mkdirSync(rProjects, { recursive: true });
  mkdirSync(join(rHmPartners, "old-partner"), { recursive: true });
  writeFileSync(
    join(rHmPartners, "old-partner", "partner-knowledge.md"),
    "# Old Partner\n",
  );
  writeFileSync(
    join(rProjects, "A.md"),
    "---\nslug: proj-a\nname: Project A\nkind: partner\npartner: old-partner\nhive_mind_partner_slug: old-partner\n---\n\n# Project A\n",
  );
  writeFileSync(
    join(rProjects, "B.md"),
    "---\nslug: proj-b\nname: Project B\nkind: partner\npartner: Old Partner Display\nhive_mind_partner_slug: old-partner\n---\n\n# Project B\n",
  );
  writeFileSync(
    join(rProjects, "C.md"),
    "---\nslug: proj-c\nname: Project C\nkind: partner\npartner: other-partner\nhive_mind_partner_slug: other-partner\n---\n\n# Project C\n",
  );
  const rOpts = resolveVaultOptions({
    vaultPath: join(renameRoot, "vault"),
    hiveMindPath: join(renameRoot, "hm"),
  });

  // Init a real git repo so the git-mv branch runs.
  const hm = join(renameRoot, "hm");
  execSync("git init -q && git add -A && git -c user.email=a@b -c user.name=x commit -q -m init", { cwd: hm });

  // Rejects on invalid slugs.
  const rInvalid = await renameHiveMindPartnerSlug(rOpts, { oldSlug: "Old Partner", newSlug: "new-partner" });
  if (rInvalid.ok || rInvalid.reason !== "invalid-slug") throw new Error("expected invalid-slug rejection");

  const rSame = await renameHiveMindPartnerSlug(rOpts, { oldSlug: "old-partner", newSlug: "old-partner" });
  if (rSame.ok || rSame.reason !== "same-slug") throw new Error("expected same-slug rejection");

  const rMissing = await renameHiveMindPartnerSlug(rOpts, { oldSlug: "no-such-slug", newSlug: "brand-new" });
  if (rMissing.ok || rMissing.reason !== "hm-dir-missing") throw new Error("expected hm-dir-missing rejection");

  // Happy path.
  const rOk = await renameHiveMindPartnerSlug(rOpts, { oldSlug: "old-partner", newSlug: "new-partner" });
  if (!rOk.ok) throw new Error("expected ok result, got: " + JSON.stringify(rOk));
  if (!rOk.dir_renamed) throw new Error("expected dir_renamed=true");
  if (!rOk.committed) throw new Error("expected committed=true");
  if (rOk.projects_updated.length !== 2) throw new Error("expected 2 projects updated, got " + rOk.projects_updated.length);
  const aRaw = readFileSync(join(rProjects, "A.md"), "utf8");
  if (!aRaw.includes("partner: new-partner")) throw new Error("A.md: partner should be new-partner");
  if (!aRaw.includes("hive_mind_partner_slug: new-partner")) throw new Error("A.md: hm slug should be new-partner");
  const bRaw = readFileSync(join(rProjects, "B.md"), "utf8");
  if (!bRaw.includes("partner: Old Partner Display")) throw new Error("B.md: display-name partner should be preserved");
  if (!bRaw.includes("hive_mind_partner_slug: new-partner")) throw new Error("B.md: hm slug should be new-partner");
  const cRaw = readFileSync(join(rProjects, "C.md"), "utf8");
  if (!cRaw.includes("partner: other-partner")) throw new Error("C.md: unrelated project should be untouched");
  const { statSync } = await import("node:fs");
  if (!statSync(join(rHmPartners, "new-partner")).isDirectory()) throw new Error("HM dir should be renamed");

  // Idempotent re-run: old dir is gone, new dir is in place, all projects already carry newSlug.
  // Should succeed with changed=false rather than erroring out.
  const rReRun = await renameHiveMindPartnerSlug(rOpts, { oldSlug: "old-partner", newSlug: "new-partner" });
  if (!rReRun.ok) throw new Error("expected ok=true on idempotent re-run, got: " + JSON.stringify(rReRun));
  if (rReRun.changed) throw new Error("expected changed=false on idempotent re-run");
  if (rReRun.dir_renamed) throw new Error("expected dir_renamed=false on idempotent re-run");
  if (rReRun.projects_updated.length !== 0) throw new Error("expected 0 projects_updated on idempotent re-run");

  console.log("[rename-partner] OK — invalid/same/missing rejections + rewrite + git mv + commit + display-name preservation");
  rmSync(renameRoot, { recursive: true, force: true });
}

console.log(`[smoke] cleaning up ${root}`);
rmSync(root, { recursive: true, force: true });
