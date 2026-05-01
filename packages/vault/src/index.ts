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
import {
  findCallNotesByRecordingId,
  listCallNotes,
  saveCallNotes,
  type SavedCallAnalysis,
  type SavedCallNote,
  type SaveCallNotesInput,
} from "./call-notes";
import {
  applyDailySectionEdit,
  dailyNotePath,
  listDailyNotes,
  readDailyNote,
  readTodayNote,
  upsertDailySection,
} from "./daily-notes";
import {
  ensureDraftId,
  listDrafts,
  readDraft,
} from "./drafts";
import {
  appendFollowUp,
  filterFollowUpsForProject,
  listFollowUps,
  resolveFollowUp,
} from "./follow-ups";
import { readProjectDetail } from "./project-detail";
import {
  addProjectZendeskTicket,
  appendDecisionsToProject,
  createProject,
  ensureProjectId,
  listProjects,
  readProject,
  refreshProjectZendeskMetadata,
  setPrimaryZendeskTicket,
  setProjectZendeskSearchTerms,
  updateProjectFrontmatter,
  type AddProjectZendeskTicketResult,
  type AppendDecisionsInput,
  type AppendDecisionsResult,
  type CreateProjectInput,
  type CreateProjectResult,
  type RefreshZendeskMetadataResult,
  type SetPrimaryZendeskTicketResult,
  type SetProjectZendeskSearchTermsResult,
  type UpdateProjectFrontmatterPatch,
  type UpdateProjectFrontmatterResult,
} from "./projects";
import { readVaultStatus } from "./status";
import { readStyleGuide, readWorkingWith } from "./style-guide";
import {
  appendProjectTask,
  deleteProjectTask,
  editProjectTaskText,
  parseProjectTasks,
  splitTasks,
  toggleProjectTask,
} from "./tasks";
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
export type {
  AppendProjectTaskResult,
  DeleteProjectTaskResult,
  EditProjectTaskTextResult,
  ProjectTask,
  ToggleProjectTaskResult,
} from "./tasks";
export type {
  AddProjectZendeskTicketResult,
  AppendDecisionsInput,
  AppendDecisionsResult,
  CreateProjectInput,
  CreateProjectResult,
  RefreshZendeskMetadataResult,
  SetPrimaryZendeskTicketResult,
  SetProjectZendeskSearchTermsResult,
  UpdateProjectFrontmatterPatch,
  UpdateProjectFrontmatterResult,
} from "./projects";
export type {
  AppendFollowUpInput,
  AppendFollowUpResult,
  ResolveFollowUpResult,
} from "./follow-ups";
export type {
  SavedCallAnalysis,
  SavedCallNote,
  SaveCallNotesInput,
  CallNoteRef,
} from "./call-notes";
export {
  addProjectZendeskTicket,
  appendDecisionsToProject,
  appendFollowUp,
  appendProjectTask,
  applyDailySectionEdit,
  createProject,
  deleteProjectTask,
  editProjectTaskText,
  dailyNotePath,
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
  refreshProjectZendeskMetadata,
  resolveFollowUp,
  setPrimaryZendeskTicket,
  setProjectZendeskSearchTerms,
  splitTasks,
  updateProjectFrontmatter,
  toggleProjectTask,
  upsertDailySection,
  ensureDraftId,
  ensureProjectId,
  saveCallNotes,
  findCallNotesByRecordingId,
  watchVault,
};

export interface Vault {
  options: ReturnType<typeof resolveVaultOptions>;
  status: () => ReturnType<typeof readVaultStatus>;
  listProjects: () => ReturnType<typeof listProjects>;
  readProject: (slug: string) => ReturnType<typeof readProject>;
  readProjectDetail: (slug: string) => ReturnType<typeof readProjectDetail>;
  createProject: (
    input: CreateProjectInput,
  ) => ReturnType<typeof createProject>;
  listDrafts: () => ReturnType<typeof listDrafts>;
  readDraft: (id: string) => ReturnType<typeof readDraft>;
  listFollowUps: () => ReturnType<typeof listFollowUps>;
  listDailyNotes: () => ReturnType<typeof listDailyNotes>;
  readDailyNote: (date: string) => ReturnType<typeof readDailyNote>;
  readTodayNote: () => ReturnType<typeof readTodayNote>;
  dailyNotePath: (date: string) => string;
  upsertDailySection: (
    date: string,
    sectionId: string,
    bodyMarkdown: string,
  ) => ReturnType<typeof upsertDailySection>;
  listCallNotes: () => ReturnType<typeof listCallNotes>;
  listAgendas: () => ReturnType<typeof listAgendas>;
  readStyleGuide: () => ReturnType<typeof readStyleGuide>;
  readWorkingWith: () => ReturnType<typeof readWorkingWith>;
  toggleProjectTask: (
    slug: string,
    taskId: string,
    done: boolean,
  ) => ReturnType<typeof toggleProjectTask>;
  appendProjectTask: (
    slug: string,
    text: string,
  ) => ReturnType<typeof appendProjectTask>;
  editProjectTaskText: (
    slug: string,
    taskId: string,
    newText: string,
  ) => ReturnType<typeof editProjectTaskText>;
  deleteProjectTask: (
    slug: string,
    taskId: string,
  ) => ReturnType<typeof deleteProjectTask>;
  addProjectZendeskTicket: (
    slug: string,
    ticketRef: Parameters<typeof addProjectZendeskTicket>[2],
  ) => ReturnType<typeof addProjectZendeskTicket>;
  setPrimaryZendeskTicket: (
    slug: string,
    ticketId: string,
  ) => ReturnType<typeof setPrimaryZendeskTicket>;
  refreshProjectZendeskMetadata: (
    slug: string,
    summaries: Parameters<typeof refreshProjectZendeskMetadata>[2],
  ) => ReturnType<typeof refreshProjectZendeskMetadata>;
  setProjectZendeskSearchTerms: (
    slug: string,
    terms: string[],
  ) => ReturnType<typeof setProjectZendeskSearchTerms>;
  updateProjectFrontmatter: (
    slug: string,
    patch: Parameters<typeof updateProjectFrontmatter>[2],
  ) => ReturnType<typeof updateProjectFrontmatter>;
  resolveFollowUp: (
    followUpId: string,
    note?: string,
  ) => ReturnType<typeof resolveFollowUp>;
  appendFollowUp: (
    input: Parameters<typeof appendFollowUp>[1],
  ) => ReturnType<typeof appendFollowUp>;
  appendDecisionsToProject: (
    slug: string,
    input: Parameters<typeof appendDecisionsToProject>[2],
  ) => ReturnType<typeof appendDecisionsToProject>;
  saveCallNotes: (
    input: Parameters<typeof saveCallNotes>[1],
  ) => ReturnType<typeof saveCallNotes>;
  findCallNotesByRecordingId: (
    recordingId: string,
  ) => ReturnType<typeof findCallNotesByRecordingId>;
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
    createProject: (input) => createProject(resolved, input),
    listDrafts: () => listDrafts(resolved),
    readDraft: (id) => readDraft(resolved, id),
    listFollowUps: () => listFollowUps(resolved),
    listDailyNotes: () => listDailyNotes(resolved),
    readDailyNote: (date) => readDailyNote(resolved, date),
    readTodayNote: () => readTodayNote(resolved),
    dailyNotePath: (date) => dailyNotePath(resolved, date),
    upsertDailySection: (date, sectionId, body) =>
      upsertDailySection(resolved, date, sectionId, body),
    listCallNotes: () => listCallNotes(resolved),
    listAgendas: () => listAgendas(resolved),
    readStyleGuide: () => readStyleGuide(resolved),
    readWorkingWith: () => readWorkingWith(resolved),
    toggleProjectTask: (slug, taskId, done) =>
      toggleProjectTask(resolved, slug, taskId, done),
    appendProjectTask: (slug, text) =>
      appendProjectTask(resolved, slug, text),
    editProjectTaskText: (slug, taskId, newText) =>
      editProjectTaskText(resolved, slug, taskId, newText),
    deleteProjectTask: (slug, taskId) =>
      deleteProjectTask(resolved, slug, taskId),
    addProjectZendeskTicket: (slug, ticketRef) =>
      addProjectZendeskTicket(resolved, slug, ticketRef),
    setPrimaryZendeskTicket: (slug, ticketId) =>
      setPrimaryZendeskTicket(resolved, slug, ticketId),
    refreshProjectZendeskMetadata: (slug, summaries) =>
      refreshProjectZendeskMetadata(resolved, slug, summaries),
    setProjectZendeskSearchTerms: (slug, terms) =>
      setProjectZendeskSearchTerms(resolved, slug, terms),
    updateProjectFrontmatter: (slug, patch) =>
      updateProjectFrontmatter(resolved, slug, patch),
    resolveFollowUp: (followUpId, note) =>
      resolveFollowUp(resolved, followUpId, note),
    appendFollowUp: (input) => appendFollowUp(resolved, input),
    appendDecisionsToProject: (slug, input) =>
      appendDecisionsToProject(resolved, slug, input),
    saveCallNotes: (input) => saveCallNotes(resolved, input),
    findCallNotesByRecordingId: (recordingId) =>
      findCallNotesByRecordingId(resolved, recordingId),
    watch: (handler) => watchVault(resolved, handler),
  };
}
