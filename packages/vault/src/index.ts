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
import {
  addAgendaItem,
  agendaExists,
  archiveCheckedAgendaItems,
  listAgendas,
  readAgenda,
  setAgendaItemChecked,
  type Agenda,
  type AgendaArchiveSection,
  type AgendaItem,
  type AgendaMutationResult,
  type AgendaRef,
} from "./agendas";
import {
  appendChatToCallNotes,
  findCallNotesByRecordingId,
  listCallNotes,
  listRecentCallSlices,
  saveCallNotes,
  type AppendChatToCallNotesResult,
  type ChatMessage,
  type RecentCallSlice,
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
  archiveDraft,
  createDraftFromAi,
  ensureDraftId,
  listArchivedDraftsWithDiffs,
  listDrafts,
  readDraft,
  updateDraftBody,
  type ArchiveDraftResult,
  type ArchivedDraftWithDiff,
  type CreateDraftFromAiInput,
  type CreateDraftFromAiResult,
  type UpdateDraftBodyResult,
} from "./drafts";
import {
  appendFollowUp,
  deleteFollowUp,
  filterFollowUpsForProject,
  listFollowUps,
  resolveFollowUp,
  snoozeFollowUp,
  updateFollowUp,
} from "./follow-ups";
import { readProjectDetail } from "./project-detail";
import {
  addProjectZendeskTicket,
  appendDecisionsToProject,
  createProject,
  createProjectScratchpad,
  ensureProjectId,
  addFathomExcludedRecordingId,
  listProjects,
  readProject,
  refreshProjectZendeskMetadata,
  setPrimaryZendeskTicket,
  setProjectFathomSearchTerms,
  setProjectZendeskSearchTerms,
  updateProjectFrontmatter,
  type AddFathomExcludedRecordingIdResult,
  type AddProjectZendeskTicketResult,
  type AppendDecisionsInput,
  type AppendDecisionsResult,
  type CreateProjectInput,
  type CreateProjectResult,
  type CreateProjectScratchpadInput,
  type CreateProjectScratchpadResult,
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
import {
  getHiveMindBrief,
  getHiveMindCallTranscripts,
  getHiveMindDrafts,
  getHiveMindFollowUps,
  getHiveMindNotes,
  getHiveMindPartner,
  getHiveMindPinnedContext,
  getHiveMindProject,
  getHiveMindSkillContent,
  getHiveMindZendesk,
  listHiveMindSkills,
  serializeHiveMindPinnedContext,
  type FollowUpRow,
  type HiveMindBrief,
  type HiveMindCallTranscript,
  type HiveMindDraft,
  type HiveMindFollowUpsData,
  type HiveMindPartner,
  type HiveMindPartnerContact,
  type HiveMindPinnedContextData,
  type HiveMindPinnedContextRow,
  type HiveMindPinnedContextType,
  type HiveMindSkill,
  type HiveMindSkillContent,
  type HiveMindProject,
  type HiveMindZendeskData,
} from "./hive-mind";
import { watchVault, type VaultEventHandler } from "./watcher";
import {
  listWeeklyUpdates,
  listWeeklyUpdatesWithDiffs,
  readWeeklyUpdate,
  saveWeeklyUpdate,
  type SaveWeeklyUpdateInput,
  type WeeklyUpdate,
  type WeeklyUpdateFrontmatter,
  type WeeklyUpdateRow,
  type WeeklyUpdateWithDiff,
} from "./weekly-updates";
import {
  listWeeklyHighlights,
  readPersonalDevelopment,
  readWeeklyHighlight,
  savePersonalDevelopment,
  saveWeeklyHighlight,
  type PersonalDevelopment,
  type SavePersonalDevelopmentResult,
  type SaveWeeklyHighlightInput,
  type SaveWeeklyHighlightResult,
  type WeeklyHighlight,
  type WeeklyHighlightFrontmatter,
  type WeeklyHighlightRow,
} from "./personal-digest";

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
  CreateProjectScratchpadInput,
  CreateProjectScratchpadResult,
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
  SnoozeFollowUpResult,
  UpdateFollowUpPatch,
  UpdateFollowUpResult,
} from "./follow-ups";
export type {
  ArchiveDraftResult,
  ArchivedDraftWithDiff,
  CreateDraftFromAiInput,
  CreateDraftFromAiResult,
  UpdateDraftBodyResult,
} from "./drafts";
export type {
  AppendChatToCallNotesResult,
  ChatMessage,
  SavedCallAnalysis,
  SavedCallNote,
  SaveCallNotesInput,
  CallNoteRef,
} from "./call-notes";
export type {
  FollowUpRow,
  HiveMindBrief,
  HiveMindCallTranscript,
  HiveMindDraft,
  HiveMindFollowUpsData,
  HiveMindPartner,
  HiveMindPartnerContact,
  HiveMindPinnedContextData,
  HiveMindPinnedContextRow,
  HiveMindPinnedContextType,
  HiveMindProject,
  HiveMindSkill,
  HiveMindSkillContent,
  HiveMindZendeskData,
} from "./hive-mind";
export {
  addProjectZendeskTicket,
  appendChatToCallNotes,
  getHiveMindBrief,
  getHiveMindCallTranscripts,
  getHiveMindDrafts,
  getHiveMindFollowUps,
  getHiveMindNotes,
  getHiveMindPartner,
  getHiveMindPinnedContext,
  getHiveMindProject,
  getHiveMindSkillContent,
  getHiveMindZendesk,
  listHiveMindSkills,
  serializeHiveMindPinnedContext,
  appendDecisionsToProject,
  appendFollowUp,
  appendProjectTask,
  applyDailySectionEdit,
  createProject,
  createProjectScratchpad,
  deleteProjectTask,
  editProjectTaskText,
  dailyNotePath,
  filterFollowUpsForProject,
  addAgendaItem,
  agendaExists,
  archiveCheckedAgendaItems,
  listAgendas,
  readAgenda,
  setAgendaItemChecked,
  type Agenda,
  type AgendaArchiveSection,
  type AgendaItem,
  type AgendaMutationResult,
  type AgendaRef,
  listCallNotes,
  listRecentCallSlices,
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
  deleteFollowUp,
  resolveFollowUp,
  snoozeFollowUp,
  updateFollowUp,
  setPrimaryZendeskTicket,
  setProjectFathomSearchTerms,
  setProjectZendeskSearchTerms,
  addFathomExcludedRecordingId,
  splitTasks,
  updateProjectFrontmatter,
  toggleProjectTask,
  upsertDailySection,
  ensureDraftId,
  ensureProjectId,
  saveCallNotes,
  findCallNotesByRecordingId,
  updateDraftBody,
  createDraftFromAi,
  archiveDraft,
  listArchivedDraftsWithDiffs,
  listWeeklyUpdates,
  listWeeklyUpdatesWithDiffs,
  readWeeklyUpdate,
  saveWeeklyUpdate,
  listWeeklyHighlights,
  readWeeklyHighlight,
  saveWeeklyHighlight,
  readPersonalDevelopment,
  savePersonalDevelopment,
  watchVault,
};

export type {
  RecentCallSlice,
  SaveWeeklyUpdateInput,
  WeeklyUpdate,
  WeeklyUpdateFrontmatter,
  WeeklyUpdateRow,
  WeeklyUpdateWithDiff,
  PersonalDevelopment,
  SavePersonalDevelopmentResult,
  SaveWeeklyHighlightInput,
  SaveWeeklyHighlightResult,
  WeeklyHighlight,
  WeeklyHighlightFrontmatter,
  WeeklyHighlightRow,
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
  createProjectScratchpad: (
    input: CreateProjectScratchpadInput,
  ) => ReturnType<typeof createProjectScratchpad>;
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
  listRecentCallSlices: (
    range: Parameters<typeof listRecentCallSlices>[1],
  ) => ReturnType<typeof listRecentCallSlices>;
  listAgendas: () => ReturnType<typeof listAgendas>;
  readAgenda: (filename: string) => ReturnType<typeof readAgenda>;
  agendaExists: (filename: string) => ReturnType<typeof agendaExists>;
  addAgendaItem: (
    filename: string,
    text: string,
    options?: Parameters<typeof addAgendaItem>[3],
  ) => ReturnType<typeof addAgendaItem>;
  setAgendaItemChecked: (
    filename: string,
    itemId: string,
    checked: boolean,
  ) => ReturnType<typeof setAgendaItemChecked>;
  archiveCheckedAgendaItems: (
    filename: string,
    dateLabel: string,
  ) => ReturnType<typeof archiveCheckedAgendaItems>;
  readStyleGuide: () => ReturnType<typeof readStyleGuide>;
  readWorkingWith: () => ReturnType<typeof readWorkingWith>;
  listWeeklyUpdates: () => ReturnType<typeof listWeeklyUpdates>;
  listWeeklyUpdatesWithDiffs: (
    limit?: number,
  ) => ReturnType<typeof listWeeklyUpdatesWithDiffs>;
  readWeeklyUpdate: (
    isoWeek: string,
  ) => ReturnType<typeof readWeeklyUpdate>;
  saveWeeklyUpdate: (
    input: SaveWeeklyUpdateInput,
  ) => ReturnType<typeof saveWeeklyUpdate>;
  listWeeklyHighlights: () => ReturnType<typeof listWeeklyHighlights>;
  readWeeklyHighlight: (
    isoWeek: string,
  ) => ReturnType<typeof readWeeklyHighlight>;
  saveWeeklyHighlight: (
    input: SaveWeeklyHighlightInput,
  ) => ReturnType<typeof saveWeeklyHighlight>;
  readPersonalDevelopment: () => ReturnType<typeof readPersonalDevelopment>;
  savePersonalDevelopment: (
    body: string,
  ) => ReturnType<typeof savePersonalDevelopment>;
  toggleProjectTask: (
    slug: string,
    taskId: string,
    done: boolean,
  ) => ReturnType<typeof toggleProjectTask>;
  appendProjectTask: (
    slug: string,
    text: string,
    markers?: Parameters<typeof appendProjectTask>[3],
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
  setProjectFathomSearchTerms: (
    slug: string,
    terms: string[],
  ) => ReturnType<typeof setProjectFathomSearchTerms>;
  addFathomExcludedRecordingId: (
    slug: string,
    recordingId: string,
  ) => ReturnType<typeof addFathomExcludedRecordingId>;
  updateProjectFrontmatter: (
    slug: string,
    patch: Parameters<typeof updateProjectFrontmatter>[2],
  ) => ReturnType<typeof updateProjectFrontmatter>;
  resolveFollowUp: (
    followUpId: string,
    note?: string,
  ) => ReturnType<typeof resolveFollowUp>;
  deleteFollowUp: (
    followUpId: string,
  ) => ReturnType<typeof deleteFollowUp>;
  snoozeFollowUp: (
    followUpId: string,
    newFollowUpBy: string,
  ) => ReturnType<typeof snoozeFollowUp>;
  updateFollowUp: (
    followUpId: string,
    patch: Parameters<typeof updateFollowUp>[2],
  ) => ReturnType<typeof updateFollowUp>;
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
  appendChatToCallNotes: (
    recordingId: string,
    messages: ChatMessage[],
  ) => ReturnType<typeof appendChatToCallNotes>;
  updateDraftBody: (
    draftId: string,
    newBody: string,
  ) => ReturnType<typeof updateDraftBody>;
  createDraftFromAi: (
    input: Parameters<typeof createDraftFromAi>[1],
  ) => ReturnType<typeof createDraftFromAi>;
  archiveDraft: (draftId: string) => ReturnType<typeof archiveDraft>;
  listArchivedDraftsWithDiffs: (
    limit?: number,
  ) => ReturnType<typeof listArchivedDraftsWithDiffs>;
  getHiveMindPartner: (
    partnerSlug: string,
  ) => ReturnType<typeof getHiveMindPartner>;
  getHiveMindProject: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindProject>;
  getHiveMindNotes: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindNotes>;
  getHiveMindCallTranscripts: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindCallTranscripts>;
  getHiveMindDrafts: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindDrafts>;
  getHiveMindZendesk: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindZendesk>;
  getHiveMindPinnedContext: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindPinnedContext>;
  getHiveMindFollowUps: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindFollowUps>;
  getHiveMindBrief: (
    partnerSlug: string,
    projectSlug: string,
  ) => ReturnType<typeof getHiveMindBrief>;
  listHiveMindSkills: () => ReturnType<typeof listHiveMindSkills>;
  getHiveMindSkillContent: (
    slug: string,
  ) => ReturnType<typeof getHiveMindSkillContent>;
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
    createProjectScratchpad: (input) => createProjectScratchpad(resolved, input),
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
    listRecentCallSlices: (range) => listRecentCallSlices(resolved, range),
    listAgendas: () => listAgendas(resolved),
    readAgenda: (filename) => readAgenda(resolved, filename),
    agendaExists: (filename) => agendaExists(resolved, filename),
    addAgendaItem: (filename, text, options) =>
      addAgendaItem(resolved, filename, text, options),
    setAgendaItemChecked: (filename, itemId, checked) =>
      setAgendaItemChecked(resolved, filename, itemId, checked),
    archiveCheckedAgendaItems: (filename, dateLabel) =>
      archiveCheckedAgendaItems(resolved, filename, dateLabel),
    readStyleGuide: () => readStyleGuide(resolved),
    readWorkingWith: () => readWorkingWith(resolved),
    listWeeklyUpdates: () => listWeeklyUpdates(resolved),
    readWeeklyUpdate: (isoWeek) => readWeeklyUpdate(resolved, isoWeek),
    saveWeeklyUpdate: (input) => saveWeeklyUpdate(resolved, input),
    listWeeklyUpdatesWithDiffs: (limit) =>
      listWeeklyUpdatesWithDiffs(resolved, limit),
    listWeeklyHighlights: () => listWeeklyHighlights(resolved),
    readWeeklyHighlight: (isoWeek) => readWeeklyHighlight(resolved, isoWeek),
    saveWeeklyHighlight: (input) => saveWeeklyHighlight(resolved, input),
    readPersonalDevelopment: () => readPersonalDevelopment(resolved),
    savePersonalDevelopment: (body) => savePersonalDevelopment(resolved, body),
    toggleProjectTask: (slug, taskId, done) =>
      toggleProjectTask(resolved, slug, taskId, done),
    appendProjectTask: (slug, text, markers) =>
      appendProjectTask(resolved, slug, text, markers),
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
    setProjectFathomSearchTerms: (slug, terms) =>
      setProjectFathomSearchTerms(resolved, slug, terms),
    addFathomExcludedRecordingId: (slug, recordingId) =>
      addFathomExcludedRecordingId(resolved, slug, recordingId),
    updateProjectFrontmatter: (slug, patch) =>
      updateProjectFrontmatter(resolved, slug, patch),
    resolveFollowUp: (followUpId, note) =>
      resolveFollowUp(resolved, followUpId, note),
    deleteFollowUp: (followUpId) => deleteFollowUp(resolved, followUpId),
    snoozeFollowUp: (followUpId, newFollowUpBy) =>
      snoozeFollowUp(resolved, followUpId, newFollowUpBy),
    updateFollowUp: (followUpId, patch) =>
      updateFollowUp(resolved, followUpId, patch),
    appendFollowUp: (input) => appendFollowUp(resolved, input),
    appendDecisionsToProject: (slug, input) =>
      appendDecisionsToProject(resolved, slug, input),
    saveCallNotes: (input) => saveCallNotes(resolved, input),
    findCallNotesByRecordingId: (recordingId) =>
      findCallNotesByRecordingId(resolved, recordingId),
    appendChatToCallNotes: (recordingId, messages) =>
      appendChatToCallNotes(resolved, recordingId, messages),
    updateDraftBody: (draftId, newBody) =>
      updateDraftBody(resolved, draftId, newBody),
    createDraftFromAi: (input) => createDraftFromAi(resolved, input),
    archiveDraft: (draftId) => archiveDraft(resolved, draftId),
    listArchivedDraftsWithDiffs: (limit) =>
      listArchivedDraftsWithDiffs(resolved, limit),
    getHiveMindPartner: (partnerSlug) =>
      getHiveMindPartner(resolved, partnerSlug),
    getHiveMindProject: (partnerSlug, projectSlug) =>
      getHiveMindProject(resolved, partnerSlug, projectSlug),
    getHiveMindNotes: (partnerSlug, projectSlug) =>
      getHiveMindNotes(resolved, partnerSlug, projectSlug),
    getHiveMindCallTranscripts: (partnerSlug, projectSlug) =>
      getHiveMindCallTranscripts(resolved, partnerSlug, projectSlug),
    getHiveMindDrafts: (partnerSlug, projectSlug) =>
      getHiveMindDrafts(resolved, partnerSlug, projectSlug),
    getHiveMindZendesk: (partnerSlug, projectSlug) =>
      getHiveMindZendesk(resolved, partnerSlug, projectSlug),
    getHiveMindPinnedContext: (partnerSlug, projectSlug) =>
      getHiveMindPinnedContext(resolved, partnerSlug, projectSlug),
    getHiveMindFollowUps: (partnerSlug, projectSlug) =>
      getHiveMindFollowUps(resolved, partnerSlug, projectSlug),
    getHiveMindBrief: (partnerSlug, projectSlug) =>
      getHiveMindBrief(resolved, partnerSlug, projectSlug),
    listHiveMindSkills: () => listHiveMindSkills(resolved),
    getHiveMindSkillContent: (slug) => getHiveMindSkillContent(resolved, slug),
    watch: (handler) => watchVault(resolved, handler),
  };
}
