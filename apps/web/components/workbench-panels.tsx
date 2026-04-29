import * as React from "react";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  FileEdit,
  FolderOpen,
  Inbox,
  ListChecks,
  Phone,
  ShieldCheck,
  Sparkles,
  StickyNote,
} from "lucide-react";

import type { PartnerProfile } from "@smithers/mcp-client";
import type {
  Draft,
  FollowUp,
  Project,
  ProjectTask,
  SiblingFile,
} from "@smithers/vault";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

// -- Section primitive ----------------------------------------------------

function Section({
  icon,
  title,
  count,
  meta,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  meta?: string;
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
            <span className="text-muted-foreground/70 ml-auto text-xs font-normal">
              {meta}
            </span>
          ) : null}
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

// -- For You Today --------------------------------------------------------

export function ForYouTodayPanel({ project }: { project: Project }) {
  return (
    <Section
      icon={<Sparkles className="size-4" />}
      title="For you today"
      meta="Lands with packages/agents"
    >
      <ComingSoon>
        Auto-suggested next steps for {project.name} will appear here once the
        agents runtime is online: a small set of inline ghost-button affordances
        like &ldquo;Draft a reply&rdquo;, &ldquo;Suggest next step&rdquo;, and
        &ldquo;Compose follow-up nudge&rdquo;.
      </ComingSoon>
    </Section>
  );
}

// -- Project brief --------------------------------------------------------

export function ProjectBriefPanel({
  project,
  body,
}: {
  project: Project;
  body: string;
}) {
  return (
    <Section
      icon={<FolderOpen className="size-4" />}
      title="Project brief"
      meta={`updated ${formatDate(project.modified_at)}`}
    >
      {body.trim().length > 0 ? (
        <Markdown source={body} />
      ) : (
        <p className="text-muted-foreground text-sm italic">
          No body content in {project.source.relative_path}. Add some markdown
          there and it will render here.
        </p>
      )}
    </Section>
  );
}

// -- Open items (parsed checkboxes) ---------------------------------------

export function OpenItemsPanel({
  open,
  done,
}: {
  open: ProjectTask[];
  done: ProjectTask[];
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
          No checkbox items found in the project body. Add{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            - [ ] Task
          </code>{" "}
          lines to track them here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {open.map((t) => (
            <li
              key={t.task_id}
              className="flex items-start gap-2 py-1.5 first:pt-0"
            >
              <Circle className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm leading-snug">{t.text}</p>
                {t.section ? (
                  <p className="text-muted-foreground text-[11px] uppercase tracking-wide">
                    {t.section}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
          {done.slice(0, 4).map((t) => (
            <li
              key={t.task_id}
              className="text-muted-foreground flex items-start gap-2 py-1.5 last:pb-0"
            >
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              <p className="text-sm leading-snug line-through">{t.text}</p>
            </li>
          ))}
          {done.length > 4 ? (
            <li className="text-muted-foreground/70 py-1 text-[11px]">
              + {done.length - 4} more completed
            </li>
          ) : null}
        </ul>
      )}
    </Section>
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
        "flex items-start gap-2 py-2 first:pt-0 last:pb-0",
        dim && "text-muted-foreground",
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
    </li>
  );
}

// -- Follow-ups (filtered) ------------------------------------------------

export function FollowUpsForProjectPanel({
  followUps,
  projectName,
}: {
  followUps: { active: FollowUp[]; resolved: FollowUp[] };
  projectName: string;
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
      {followUps.active.length === 0 && followUps.resolved.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          No follow-ups matched to {projectName}. They&rsquo;re matched fuzzily
          against the &ldquo;Project&rdquo; column in{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            Follow-ups.md
          </code>
          .
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {followUps.active.map((f) => (
            <FollowUpRow key={f.follow_up_id} row={f} />
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
    </Section>
  );
}

function FollowUpRow({ row, dim = false }: { row: FollowUp; dim?: boolean }) {
  return (
    <li
      className={cn(
        "flex items-start gap-2 py-2 first:pt-0 last:pb-0",
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
    </li>
  );
}

// -- Personal notes (notes.md from folder layout) -------------------------

export function PersonalNotesPanel({ notes }: { notes: SiblingFile | null }) {
  return (
    <Section
      icon={<StickyNote className="size-4" />}
      title="Personal notes"
      meta={notes ? `updated ${formatDate(notes.modified_at)}` : "local only"}
    >
      {notes ? (
        <Markdown source={notes.body} />
      ) : (
        <ComingSoon>
          Personal notes for this project (
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            Projects/&lt;slug&gt;/notes.md
          </code>
          ) are private and stay in your local vault &mdash; never synced to
          Hive Mind. None exist yet for this project.
        </ComingSoon>
      )}
    </Section>
  );
}

// -- Recent call notes (placeholder until transcription package lands) ----

export function CallNotesPanel({ projectName }: { projectName: string }) {
  return (
    <Section
      icon={<Phone className="size-4" />}
      title="Recent calls"
      meta="Lands with packages/transcription"
    >
      <ComingSoon>
        Call notes attached to {projectName} will surface here as your
        transcription provider drops them into{" "}
        <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
          Call Notes/
        </code>
        . The vault watcher will tag each one to its project automatically.
      </ComingSoon>
    </Section>
  );
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
