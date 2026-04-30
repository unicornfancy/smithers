#!/usr/bin/env node
// Smoke for toggleProjectTask: build a tiny temp vault, flip a checkbox both
// directions, assert the file content matches expectations, clean up.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createVault,
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
console.log(`[toggle] cleaning up ${root}`);
rmSync(root, { recursive: true, force: true });
