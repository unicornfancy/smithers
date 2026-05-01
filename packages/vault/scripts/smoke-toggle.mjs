#!/usr/bin/env node
// Smoke for toggleProjectTask: build a tiny temp vault, flip a checkbox both
// directions, assert the file content matches expectations, clean up.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addProjectZendeskTicket,
  appendFollowUp,
  appendProjectTask,
  createVault,
  deleteProjectTask,
  editProjectTaskText,
  parseProjectTasks,
  refreshProjectZendeskMetadata,
  resolveFollowUp,
  setPrimaryZendeskTicket,
  setProjectZendeskSearchTerms,
  toggleProjectTask,
  updateProjectFrontmatter,
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

console.log(`[smoke] cleaning up ${root}`);
rmSync(root, { recursive: true, force: true });
