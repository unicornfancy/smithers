import * as React from "react";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileEdit,
  Inbox,
  ListChecks,
  NotebookText,
  Phone,
  ShieldCheck,
  StickyNote,
} from "lucide-react";

import { AddExternalCallDialog } from "@/components/add-external-call-dialog";
import { AddProjectFollowUpForm } from "@/components/add-project-follow-up-form";
import { ConvertFollowUpToTaskButton } from "@/components/convert-follow-up-to-task-button";
import { DetachRecordingButton } from "@/components/detach-recording-button";
import { ResolveFollowUpButton } from "@/components/resolve-follow-up-button";
import { SnoozeFollowUpButton } from "@/components/snooze-follow-up-button";

import type {
  CallRecordingRef,
  LinearProjectUpdate,
  PartnerProfile,
} from "@smithers/mcp-client";
import type { HiveMindCallTranscript } from "@smithers/vault";
import type {
  Draft,
  FollowUp,
  Project,
  ProjectTask,
  SiblingFile,
} from "@smithers/vault";

import { cn } from "@/lib/utils";
import { encodeDraftIdForUrl } from "@/lib/draft-id-url";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { AddProjectTaskInput } from "@/components/add-project-task-input";
import { PersonalNotesEditor } from "@/components/personal-notes-editor";
import { DeleteProjectTaskButton } from "@/components/delete-project-task-button";
import { EditableTaskText } from "@/components/editable-task-text";
import { AddProjectLogNoteInput } from "@/components/add-project-log-note-input";
import { ProcessCallDialog } from "@/components/process-call-dialog";
import { ProjectTaskCheckbox } from "@/components/project-task-checkbox";
import { ViewTranscriptButton } from "@/components/view-transcript-button";

// -- Section primitive ----------------------------------------------------

function Section({
  icon,
  title,
  count,
  meta,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  meta?: string;
  /** Right-aligned action slot (e.g. an "Add" button). Pushes meta further left when present. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-muted-foreground">{icon}</span>
          {title}
          {typeof count === "number" ? (
            <span className="text-muted-foreground text-xs font-normal">
              · {count}
            </span>
          ) : null}
          {meta ? (
            <span className={`text-muted-foreground/70 ${action ? "" : "ml-auto"} text-xs font-normal`}>
              {meta}
            </span>
          ) : null}
          {action ? <span className="ml-auto">{action}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ComingSoon({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 text-muted-foreground rounded-md border border-dashed p-3 text-xs">
      {children}
    </div>
  );
}

// -- Project Log ----------------------------------------------------------

interface ProjectLogEntry {
  date: string;
  heading: string;
  body: string;
  source: "notes" | "linear";
  health?: string;
  author?: string;
}

function parseNotesEntries(body: string): ProjectLogEntry[] {
  if (!body.trim()) return [];
  const entries: ProjectLogEntry[] = [];
  // Split on lines that start "### YYYY-MM-DD"
  const parts = body.split(/(?=^### \d{4}-\d{2}-\d{2})/m);
  for (const part of parts) {
    const match = part.match(/^### (\d{4}-\d{2}-\d{2})(?:\s+[—\-–]\s+(.+))?\s*\n?([\s\S]*)$/);
    if (!match) continue;
    const date = match[1];
    if (!date) continue;
    const heading = match[2] ?? "Note";
    const bodyText = match[3] ?? "";
    entries.push({
      date,
      heading: heading.trim(),
      body: bodyText.trim(),
      source: "notes",
    });
  }
  return entries;
}

function linearUpdateToEntry(update: LinearProjectUpdate): ProjectLogEntry {
  return {
    date: update.createdAt.slice(0, 10),
    heading: "Linear Update",
    body: update.body,
    source: "linear",
    health: update.health,
    author: update.user.displayName,
  };
}

export function ProjectLogPanel({
  project,
  projectNotes,
  linearUpdates,
}: {
  project: Project;
  projectNotes: string | null;
  linearUpdates: LinearProjectUpdate[];
}) {
  const notesEntries = projectNotes ? parseNotesEntries(projectNotes) : [];
  const linearEntries = linearUpdates.map(linearUpdateToEntry);
  const all = [...notesEntries, ...linearEntries].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <Section
      icon={<NotebookText className="size-4" />}
      title="Project log"
      meta={`updated ${formatDate(project.modified_at)}`}
    >
      <AddProjectLogNoteInput
        projectSlug={project.slug}
        hiveMindConfigured={Boolean(project.hive_mind_partner_slug)}
      />
      {all.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm italic">
          No project log entries yet.
        </p>
      ) : (
        <div className="mt-3 flex flex-col divide-y">
          {all.map((entry, i) => (
            <div key={`${entry.source}-${entry.date}-${i}`} className="py-3 first:pt-0 last:pb-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  {entry.date}
                </span>
                <span className="text-sm font-medium leading-snug">
                  {entry.heading}
                </span>
                {entry.health ? <HealthBadgeInline health={entry.health} /> : null}
                {entry.author ? (
                  <span className="text-muted-foreground text-[11px]">
                    {entry.author}
                  </span>
                ) : null}
              </div>
              {entry.body ? (
                <div className="text-muted-foreground text-sm">
                  <Markdown source={entry.body} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function HealthBadgeInline({ health }: { health: string }) {
  const styles: Record<string, string> = {
    onTrack: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    atRisk: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    offTrack: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  const label: Record<string, string> = {
    onTrack: "On Track",
    atRisk: "At Risk",
    offTrack: "Off Track",
  };
  const cls = styles[health] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
        cls,
      )}
    >
      {label[health] ?? health}
    </span>
  );
}

// -- Open items (parsed checkboxes) ---------------------------------------

export function OpenItemsPanel({
  projectSlug,
  projectName,
  open,
  done,
  githubRepo,
}: {
  projectSlug: string;
  projectName?: string;
  open: ProjectTask[];
  done: ProjectTask[];
  githubRepo?: string | null;
}) {
  return (
    <Section
      icon={<ListChecks className="size-4" />}
      title="Open items"
      count={open.length}
      meta={done.length > 0 ? `${done.length} done` : undefined}
    >
      {open.length === 0 && done.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          No checkbox items yet. Add one below, or write{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            - [ ] Task
          </code>{" "}
          lines directly in the file.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {open.map((t) => (
            <li
              key={t.task_id}
              className="group flex items-start gap-2 py-1.5 first:pt-0"
              style={t.indent > 0 ? { paddingLeft: `${t.indent * 8}px` } : undefined}
            >
              <ProjectTaskCheckbox
                projectSlug={projectSlug}
                taskId={t.task_id}
                done={false}
                label={t.text}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <EditableTaskText
                  projectSlug={projectSlug}
                  taskId={t.task_id}
                  text={t.text}
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {t.section ? (
                    <p className="text-muted-foreground text-[11px] uppercase tracking-wide">
                      {t.section}
                    </p>
                  ) : null}
                  {t.priority ? (
                    <PriorityBadge priority={t.priority} />
                  ) : null}
                  {t.due_date ? (
                    <DueDateLabel due_date={t.due_date} />
                  ) : null}
                </div>
              </div>
              {githubRepo ? (
                <a
                  href={`https://github.com/${githubRepo}/issues/new?title=${encodeURIComponent(t.text)}&body=${encodeURIComponent(`From Smithers project: ${projectName ?? projectSlug}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Create GitHub issue"
                  className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Create GitHub issue: ${t.text}`}
                >
                  <GitHubIcon className="size-3.5" />
                </a>
              ) : null}
              <DeleteProjectTaskButton
                projectSlug={projectSlug}
                taskId={t.task_id}
                label={t.text}
              />
            </li>
          ))}
          {done.slice(0, 4).map((t) => (
            <li
              key={t.task_id}
              className="text-muted-foreground group flex items-start gap-2 py-1.5 last:pb-0"
              style={t.indent > 0 ? { paddingLeft: `${t.indent * 8}px` } : undefined}
            >
              <ProjectTaskCheckbox
                projectSlug={projectSlug}
                taskId={t.task_id}
                done={true}
                label={t.text}
              />
              <div className="min-w-0 flex-1">
                <EditableTaskText
                  projectSlug={projectSlug}
                  taskId={t.task_id}
                  text={t.text}
                  dim
                />
              </div>
              <DeleteProjectTaskButton
                projectSlug={projectSlug}
                taskId={t.task_id}
                label={t.text}
              />
            </li>
          ))}
          {done.length > 4 ? (
            <li className="text-muted-foreground/70 py-1 text-[11px]">
              + {done.length - 4} more completed
            </li>
          ) : null}
        </ul>
      )}
      <AddProjectTaskInput projectSlug={projectSlug} />
    </Section>
  );
}

function PriorityBadge({
  priority,
}: {
  priority: "high" | "medium" | "low";
}) {
  const styles = {
    high: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    low: "bg-slate-100 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        styles[priority],
      )}
    >
      {priority}
    </span>
  );
}

function DueDateLabel({ due_date }: { due_date: string }) {
  const ts = Date.parse(due_date);
  const isPast = !Number.isNaN(ts) && ts < Date.now();
  const formatted = Number.isNaN(ts)
    ? due_date
    : new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  return (
    <span
      className={cn(
        "text-[11px]",
        isPast
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground",
      )}
    >
      due {formatted}
    </span>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// -- Drafts in flight (filtered to project) -------------------------------

export function DraftsForProjectPanel({
  drafts,
  projectName,
}: {
  drafts: Draft[];
  projectName: string;
}) {
  const inFlight = drafts.filter((d) => d.state === "in-progress");
  const archived = drafts.filter((d) => d.state === "archived");
  return (
    <Section
      icon={<FileEdit className="size-4" />}
      title="Drafts"
      count={inFlight.length}
      meta={archived.length > 0 ? `${archived.length} archived` : undefined}
    >
      {drafts.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          No drafts attached to {projectName} yet. Drafts get attached when
          their frontmatter has{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            project_slug
          </code>{" "}
          set, or when they sit under a project folder.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {inFlight.map((d) => (
            <DraftRow key={d.draft_id} draft={d} />
          ))}
          {archived.slice(0, 3).map((d) => (
            <DraftRow key={d.draft_id} draft={d} dim />
          ))}
          {archived.length > 3 ? (
            <li className="text-muted-foreground/70 py-1 text-[11px]">
              + {archived.length - 3} more archived
            </li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}

function DraftRow({ draft, dim = false }: { draft: Draft; dim?: boolean }) {
  return (
    <li
      className={cn(
        "py-0 first:pt-0 last:pb-0",
        dim && "text-muted-foreground",
      )}
    >
      <a
        href={`/drafts/${encodeDraftIdForUrl(draft.draft_id)}`}
        className={cn(
          "hover:bg-muted/40 -mx-2 flex items-start gap-2 rounded-md px-2 py-2 transition-colors",
        )}
      >
        {draft.state === "archived" ? (
          <Archive className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <FileEdit className="mt-0.5 size-3.5 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            className={cn(
              "truncate text-sm font-medium leading-snug",
              dim && "line-through",
            )}
          >
            {draft.title}
          </p>
          <p className="text-muted-foreground truncate text-[11px]">
            {draft.relative_path}
          </p>
        </div>
        <span className="text-muted-foreground/80 shrink-0 text-[11px] tabular-nums">
          {formatDate(draft.modified_at)}
        </span>
      </a>
    </li>
  );
}

// -- Follow-ups (filtered) ------------------------------------------------

export function FollowUpsForProjectPanel({
  followUps,
  projectName,
  projectSlug,
  defaultWindowDays,
}: {
  followUps: { active: FollowUp[]; resolved: FollowUp[] };
  projectName: string;
  projectSlug: string;
  /** Default days-from-now for the inline "Add follow-up" form. */
  defaultWindowDays: number;
}) {
  const totalActive = followUps.active.length;
  return (
    <Section
      icon={<Inbox className="size-4" />}
      title="Follow-ups"
      count={totalActive}
      meta={
        followUps.resolved.length > 0
          ? `${followUps.resolved.length} resolved`
          : undefined
      }
    >
      <div className="space-y-2">
        {followUps.active.length === 0 && followUps.resolved.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No follow-ups matched to {projectName} yet. Add one below.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {followUps.active.map((f) => (
              <FollowUpRow
                key={f.follow_up_id}
                row={f}
                projectSlug={projectSlug}
              />
            ))}
            {followUps.resolved.slice(0, 3).map((f) => (
              <FollowUpRow key={f.follow_up_id} row={f} dim />
            ))}
            {followUps.resolved.length > 3 ? (
              <li className="text-muted-foreground/70 py-1 text-[11px]">
                + {followUps.resolved.length - 3} more resolved
              </li>
            ) : null}
          </ul>
        )}
        <AddProjectFollowUpForm
          projectSlug={projectSlug}
          projectName={projectName}
          defaultWindowDays={defaultWindowDays}
        />
      </div>
    </Section>
  );
}

function FollowUpRow({
  row,
  dim = false,
  projectSlug,
}: {
  row: FollowUp;
  dim?: boolean;
  projectSlug?: string;
}) {
  const isActive = row.status !== "resolved";
  return (
    <li
      className={cn(
        "group flex items-start gap-2 py-2 first:pt-0 last:pb-0",
        dim && "text-muted-foreground",
      )}
    >
      {row.status === "resolved" ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Clock className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm leading-snug">{row.task}</p>
        <p className="text-muted-foreground text-[11px]">
          sent {row.sent}
          {row.follow_up_by ? ` · due ${row.follow_up_by}` : ""}
          {row.status_note ? ` · ${row.status_note}` : ""}
        </p>
      </div>
      {isActive && projectSlug ? (
        <div className="flex shrink-0 items-center gap-1">
          <ResolveFollowUpButton
            projectSlug={projectSlug}
            followUpId={row.follow_up_id}
            label={row.task}
          />
          <SnoozeFollowUpButton
            projectSlug={projectSlug}
            followUpId={row.follow_up_id}
            label={row.task}
          />
          <ConvertFollowUpToTaskButton
            projectSlug={projectSlug}
            followUpId={row.follow_up_id}
            label={row.task}
          />
        </div>
      ) : null}
    </li>
  );
}

// -- Personal notes (notes.md from folder layout) -------------------------

export function PersonalNotesPanel({
  projectSlug,
  notes,
}: {
  projectSlug: string;
  notes: SiblingFile | null;
}) {
  return (
    <Section
      icon={<StickyNote className="size-4" />}
      title="Personal notes"
      meta={notes ? `updated ${formatDate(notes.modified_at)}` : "empty"}
    >
      <PersonalNotesEditor
        projectSlug={projectSlug}
        initialBody={notes?.body ?? ""}
        relativePath={notes?.relative_path ?? null}
        isNew={notes === null}
      />
    </Section>
  );
}

// -- Recent call notes (placeholder until transcription package lands) ----

export function CallNotesPanel({
  projectSlug,
  projectName,
  recordings,
  savedNotesByRecordingId,
  callTranscripts,
  processedCallNotes,
}: {
  projectSlug: string;
  projectName: string;
  recordings: CallRecordingRef[];
  /**
   * Per-recording lookup: if a recording has a saved Call Notes file
   * (vault `Call Notes/<file>.md` with this recording_id in
   * frontmatter), the row gets a "Notes saved" pill so the user knows
   * the analysis is persisted and clicking Process loads from cache.
   */
  savedNotesByRecordingId?: Record<
    string,
    { relative_path: string; analyzed_at: string }
  >;
  callTranscripts?: HiveMindCallTranscript[];
  /**
   * All-time list of saved Call Notes files (`project_slug` matches
   * this project) sorted newest first. These persist on the workbench
   * even after the underlying Fathom recording rolls out of the
   * adapter's recent list, so older calls don't vanish.
   */
  processedCallNotes?: Array<{
    recording_id: string;
    recorded_at: string;
    title: string;
    summary?: string;
  }>;
}) {
  // Split recordings into "matched but not processed yet" and
  // (already-processed ones are de-duped against processedCallNotes).
  const processedIds = new Set(
    (processedCallNotes ?? []).map((p) => p.recording_id).filter(Boolean),
  );
  const unprocessedRecordings = recordings.filter(
    (r) => !processedIds.has(r.recording_id),
  );

  if (
    recordings.length === 0 &&
    (!processedCallNotes || processedCallNotes.length === 0)
  ) {
    return (
      <Section
        icon={<Phone className="size-4" />}
        title="Calls"
        meta="No matches"
        action={
          <AddExternalCallDialog
            projects={[]}
            fixedProjectSlug={projectSlug}
            fixedProjectName={projectName}
            label="Add external call"
            size="sm"
            variant="ghost"
          />
        }
      >
        <p className="text-muted-foreground text-sm">
          No calls matched to {projectName}. Recordings whose titles or
          attendees include the project or partner will surface here; processed
          calls also persist across time. Use{" "}
          <span className="font-medium">Add external call</span> to import a
          transcript from elsewhere.
        </p>
      </Section>
    );
  }
  const transcriptByUrl = new Map(
    (callTranscripts ?? [])
      .filter((t) => t.frontmatter.recording_url)
      .map((t) => [t.frontmatter.recording_url!, t]),
  );

  return (
    <Section
      icon={<Phone className="size-4" />}
      title="Calls"
      count={recordings.length + (processedCallNotes?.length ?? 0)}
      meta={`${processedCallNotes?.length ?? 0} processed · ${unprocessedRecordings.length} unprocessed`}
      action={
        <AddExternalCallDialog
          projects={[]}
          fixedProjectSlug={projectSlug}
          fixedProjectName={projectName}
          label="Add external"
          size="sm"
          variant="ghost"
        />
      }
    >
      <div className="space-y-3">
        {(processedCallNotes ?? []).length > 0 ? (
          <ProcessedCallsList
            notes={processedCallNotes ?? []}
            savedNotesByRecordingId={savedNotesByRecordingId}
            recordingsById={Object.fromEntries(
              recordings.map((r) => [r.recording_id, r]),
            )}
            projectSlug={projectSlug}
          />
        ) : null}

        {unprocessedRecordings.length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Unprocessed · matched recordings
            </p>
            <ul className="flex flex-col divide-y">
              {unprocessedRecordings.map((r) => {
                const matchedTranscript = r.source_url
                  ? transcriptByUrl.get(r.source_url)
                  : undefined;
                return (
                  <li
                    key={r.recording_id}
                    className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="text-sm leading-snug">
                        {r.title ?? r.recording_id}
                      </p>
                      <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                        <span>
                          {new Date(r.recorded_at).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </span>
                      </p>
                      {matchedTranscript ? (
                        <ViewTranscriptButton transcript={matchedTranscript} />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ProcessCallDialog
                        projectSlug={projectSlug}
                        recording={r}
                      />
                      {r.source_url ? (
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                        >
                          Open
                        </a>
                      ) : null}
                      <DetachRecordingButton
                        projectSlug={projectSlug}
                        recordingId={r.recording_id}
                        recordingLabel={r.title ?? undefined}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * React-list key for processed-call rows. Prefers recording_id when
 * present; falls back to a (title, recorded_at, index) tuple so legacy
 * Call Notes files without a recording_id can't collide (Dropbox's
 * conflict resolution and Fathom's "(1)" / "(2)" suffix exports can
 * produce multiple files with the same extracted title).
 */
function rowKey(
  n: { recording_id: string; recorded_at: string; title: string },
  index: number,
): string {
  if (n.recording_id) return n.recording_id;
  return `orphan::${n.title}::${n.recorded_at}::${index}`;
}

function ProcessedCallsList({
  notes,
  savedNotesByRecordingId,
  recordingsById,
  projectSlug,
}: {
  notes: Array<{
    recording_id: string;
    recorded_at: string;
    title: string;
    summary?: string;
  }>;
  savedNotesByRecordingId?: Record<
    string,
    { relative_path: string; analyzed_at: string }
  >;
  recordingsById: Record<string, CallRecordingRef>;
  projectSlug: string;
}) {
  // Show the most recent 8 inline; collapse the rest behind a disclosure
  // so the workbench doesn't grow unbounded when Katie has dozens of
  // processed calls.
  const TOP_N = 8;
  const visible = notes.slice(0, TOP_N);
  const hidden = notes.slice(TOP_N);
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        Processed · all-time
      </p>
      <ul className="flex flex-col divide-y">
        {visible.map((n, i) => (
          <ProcessedCallRow
            key={rowKey(n, i)}
            note={n}
            savedRelPath={savedNotesByRecordingId?.[n.recording_id]?.relative_path}
            recording={recordingsById[n.recording_id]}
            projectSlug={projectSlug}
          />
        ))}
      </ul>
      {hidden.length > 0 ? (
        <details>
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
            Show {hidden.length} older processed call{hidden.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col divide-y">
            {hidden.map((n, i) => (
              <ProcessedCallRow
                key={rowKey(n, TOP_N + i)}
                note={n}
                savedRelPath={savedNotesByRecordingId?.[n.recording_id]?.relative_path}
                recording={recordingsById[n.recording_id]}
                projectSlug={projectSlug}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ProcessedCallRow({
  note,
  savedRelPath,
  recording,
  projectSlug,
}: {
  note: {
    recording_id: string;
    recorded_at: string;
    title: string;
    summary?: string;
  };
  savedRelPath: string | undefined;
  recording: CallRecordingRef | undefined;
  projectSlug: string;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm leading-snug">{note.title}</p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
          <span>
            {new Date(note.recorded_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded bg-emerald-100/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
            title={savedRelPath ? `Saved at ${savedRelPath}` : undefined}
          >
            Notes saved
          </span>
        </p>
        {note.summary ? (
          <p className="text-muted-foreground line-clamp-2 text-xs italic">
            {note.summary}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {recording ? (
          <ProcessCallDialog projectSlug={projectSlug} recording={recording} />
        ) : note.recording_id ? (
          // External imports: synthesize a CallRecordingRef so the
          // same dialog mounts. Its cached-path short-circuit reads
          // the saved analysis straight from the file by recording_id,
          // exposing the same add-task / add-follow-up / log-decision
          // controls as Fathom calls. No upstream transcript fetch
          // happens because the cached path returns before it would.
          <ProcessCallDialog
            projectSlug={projectSlug}
            recording={{
              recording_id: note.recording_id,
              recorded_at: note.recorded_at,
              duration_seconds: 0,
              title: note.title,
            }}
          />
        ) : null}
        {note.recording_id ? (
          <a
            href={`/calls/notes/${encodeURIComponent(note.recording_id)}`}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          >
            View
          </a>
        ) : null}
        {recording?.source_url ? (
          <a
            href={recording.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          >
            Open
          </a>
        ) : null}
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// -- Milestones (partner-only, deadlines.md) ------------------------------

export function MilestonesPanel({ deadlines }: { deadlines: SiblingFile | null }) {
  if (!deadlines) {
    return (
      <Section
        icon={<CalendarDays className="size-4" />}
        title="Milestones"
        meta="from deadlines.md"
      >
        <ComingSoon>
          No{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            deadlines.md
          </code>{" "}
          file in the project folder. Add one with checkbox items and dates and
          they&rsquo;ll render here as a milestone strip.
        </ComingSoon>
      </Section>
    );
  }
  return (
    <Section
      icon={<CalendarDays className="size-4" />}
      title="Milestones"
      meta={`updated ${formatDate(deadlines.modified_at)}`}
    >
      <Markdown source={deadlines.body} />
    </Section>
  );
}

// -- Partner Info ---------------------------------------------------------

export function PartnerInfoPanel({
  project,
  partner,
}: {
  project: Project;
  partner: PartnerProfile | null;
}) {
  return (
    <Section
      icon={<ShieldCheck className="size-4" />}
      title={
        partner
          ? `Partner: ${partner.display_name}`
          : project.partner
            ? `Partner: ${project.partner}`
            : "Partner info"
      }
      meta={partner?.is_mock ? "demo data" : "from Hive Mind"}
    >
      {!project.partner ? (
        <ComingSoon>
          This project doesn&rsquo;t have a partner assigned yet. Add{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            partner: &lt;slug&gt;
          </code>{" "}
          to its frontmatter to surface partner info from Hive Mind.
        </ComingSoon>
      ) : !partner ? (
        <ComingSoon>
          No Hive Mind profile found for{" "}
          <span className="text-foreground font-medium">{project.partner}</span>
          . Once the local Hive Mind clone is wired and the partner has a{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            partner-knowledge.md
          </code>
          , it will load here.
        </ComingSoon>
      ) : (
        <div className="space-y-3">
          {partner.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {partner.tags.map((t) => (
                <li
                  key={t}
                  className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wide"
                >
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          <Markdown source={partner.summary} />
          {partner.team.length > 0 ? (
            <div>
              <p className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">
                Partner team
              </p>
              <ul className="flex flex-col divide-y">
                {partner.team.map((m) => (
                  <li
                    key={m.name}
                    className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0"
                  >
                    <p className="text-sm">
                      <span className="text-foreground font-medium">
                        {m.name}
                      </span>
                      {m.role ? (
                        <span className="text-muted-foreground">
                          {" · "}
                          {m.role}
                        </span>
                      ) : null}
                    </p>
                    {m.notes ? (
                      <p className="text-muted-foreground text-xs">{m.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// -- Helpers --------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const now = new Date();
  const days = Math.floor((now.valueOf() - d.valueOf()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
