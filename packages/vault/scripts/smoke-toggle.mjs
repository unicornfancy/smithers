#!/usr/bin/env node
// Smoke for toggleProjectTask: build a tiny temp vault, flip a checkbox both
// directions, assert the file content matches expectations, clean up.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendProjectTask,
  createVault,
  editProjectTaskText,
  parseProjectTasks,
  toggleProjectTask,
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
console.log(`[smoke] cleaning up ${root}`);
rmSync(root, { recursive: true, force: true });
