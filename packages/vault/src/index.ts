// @smithers/vault — typed read/write helpers for the user's markdown vault.
//
// Two ways to use this package:
//
//   1. Function-style — call helpers directly with options:
//        const opts = resolveVaultOptions({ vaultPath: "~/notes" });
//        const projects = await listProjects(opts);
//
//   2. Factory-style — bind options once and call methods:
//        const vault = createVault({ vaultPath: "~/notes" });
//        const projects = await vault.listProjects();
//
// Both are equivalent; the factory just curries options. App-level code
// usually uses the factory; one-off scripts use the function form.

export const VAULT_PACKAGE_VERSION = "0.0.3";

import { resolveVaultOptions, type VaultOptions } from "./config";
import { listAgendas } from "./agendas";
import { listCallNotes } from "./call-notes";
import {
  listDailyNotes,
  readDailyNote,
  readTodayNote,
} from "./daily-notes";
import {
  ensureDraftId,
  listDrafts,
  readDraft,
} from "./drafts";
import { filterFollowUpsForProject, listFollowUps } from "./follow-ups";
import { readProjectDetail } from "./project-detail";
import {
  ensureProjectId,
  listProjects,
  readProject,
} from "./projects";
import { readVaultStatus } from "./status";
import { readStyleGuide, readWorkingWith } from "./style-guide";
import { parseProjectTasks, splitTasks } from "./tasks";
import { watchVault, type VaultEventHandler } from "./watcher";

export * from "./types";
export * from "./config";
export * from "./paths";
export * from "./frontmatter";
export * from "./ids";
export * from "./slug";
export * from "./watcher";
export * from "./status";
export type { ProjectDetail, SiblingFile } from "./project-detail";
export type { ProjectTask } from "./tasks";
export {
  filterFollowUpsForProject,
  listAgendas,
  listCallNotes,
  listDailyNotes,
  listDrafts,
  listFollowUps,
  listProjects,
  parseProjectTasks,
  readDailyNote,
  readDraft,
  readProject,
  readProjectDetail,
  readStyleGuide,
  readTodayNote,
  readVaultStatus,
  readWorkingWith,
  splitTasks,
  ensureDraftId,
  ensureProjectId,
  watchVault,
};

export interface Vault {
  options: ReturnType<typeof resolveVaultOptions>;
  status: () => ReturnType<typeof readVaultStatus>;
  listProjects: () => ReturnType<typeof listProjects>;
  readProject: (slug: string) => ReturnType<typeof readProject>;
  readProjectDetail: (slug: string) => ReturnType<typeof readProjectDetail>;
  listDrafts: () => ReturnType<typeof listDrafts>;
  readDraft: (id: string) => ReturnType<typeof readDraft>;
  listFollowUps: () => ReturnType<typeof listFollowUps>;
  listDailyNotes: () => ReturnType<typeof listDailyNotes>;
  readDailyNote: (date: string) => ReturnType<typeof readDailyNote>;
  readTodayNote: () => ReturnType<typeof readTodayNote>;
  listCallNotes: () => ReturnType<typeof listCallNotes>;
  listAgendas: () => ReturnType<typeof listAgendas>;
  readStyleGuide: () => ReturnType<typeof readStyleGuide>;
  readWorkingWith: () => ReturnType<typeof readWorkingWith>;
  watch: (handler: VaultEventHandler) => ReturnType<typeof watchVault>;
}

export function createVault(options: VaultOptions): Vault {
  const resolved = resolveVaultOptions(options);
  return {
    options: resolved,
    status: () => readVaultStatus(resolved),
    listProjects: () => listProjects(resolved),
    readProject: (slug) => readProject(resolved, slug),
    readProjectDetail: (slug) => readProjectDetail(resolved, slug),
    listDrafts: () => listDrafts(resolved),
    readDraft: (id) => readDraft(resolved, id),
    listFollowUps: () => listFollowUps(resolved),
    listDailyNotes: () => listDailyNotes(resolved),
    readDailyNote: (date) => readDailyNote(resolved, date),
    readTodayNote: () => readTodayNote(resolved),
    listCallNotes: () => listCallNotes(resolved),
    listAgendas: () => listAgendas(resolved),
    readStyleGuide: () => readStyleGuide(resolved),
    readWorkingWith: () => readWorkingWith(resolved),
    watch: (handler) => watchVault(resolved, handler),
  };
}
