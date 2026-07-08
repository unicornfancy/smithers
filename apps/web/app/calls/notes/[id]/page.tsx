import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckSquare,
  ExternalLink,
  Inbox,
  MessageSquare,
  Quote,
  ShieldCheck,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Markdown } from "@/components/markdown";
import { PageShell } from "@/components/page-shell";
import { ReprocessExternalCallButton } from "@/components/reprocess-external-call-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getVault } from "@/lib/server/vault";

interface Params {
  /** recording_id from the saved Call Notes frontmatter. */
  id: string;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const vault = await getVault();
  const note = await vault
    .findCallNotesByRecordingId(decodeURIComponent(id))
    .catch(() => null);
  return {
    title: note ? `${note.title} · Smithers` : "Call notes · Smithers",
  };
}

export default async function CallNotesDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const recordingId = decodeURIComponent(id);
  const vault = await getVault();
  const note = await vault.findCallNotesByRecordingId(recordingId).catch(() => null);
  if (!note) notFound();

  // Look up the parent project so the breadcrumb back-link goes somewhere
  // useful. Falls through gracefully if no project_slug is set.
  const project = note.project_slug
    ? await vault.readProject(note.project_slug).catch(() => null)
    : null;

  const a = note.analysis;
  const isExternal = recordingId.startsWith("external-");
  const [transcript, chat] = await Promise.all([
    isExternal
      ? vault.readCallNotesTranscriptByRecordingId(recordingId).catch(() => null)
      : Promise.resolve(null),
    vault.readCallNotesChatByRecordingId(recordingId).catch(() => null),
  ]);

  return (
    <>
      <AppHeader
        title={note.title}
        subtitle={
          [
            note.recorded_at?.slice(0, 10),
            project ? `· ${project.name}` : null,
            isExternal ? "· external import" : null,
          ]
            .filter(Boolean)
            .join(" ")
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={project ? `/projects/${project.slug}` : "/calls"}
                className="gap-1.5"
              >
                <ArrowLeft className="size-3.5" />
                {project ? project.name : "All calls"}
              </Link>
            </Button>
            {isExternal && transcript ? (
              <ReprocessExternalCallButton recordingId={recordingId} />
            ) : null}
            {note.fathom_url ? (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={note.fathom_url}
                  target="_blank"
                  rel="noreferrer"
                  className="gap-1.5"
                >
                  Open source
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
        }
      />
      <PageShell>
        {a.summary ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown source={a.summary} />
            </CardContent>
          </Card>
        ) : null}

        {a.action_items.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckSquare className="text-muted-foreground size-4" />
                Action items
                <span className="text-muted-foreground text-xs font-normal">
                  · {a.action_items.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {a.action_items.map((it, i) => (
                  <li key={i} className="text-sm leading-snug">
                    <span className="font-medium">{it.text}</span>
                    {it.owner && it.owner !== "unknown" ? (
                      <span className="text-muted-foreground"> · {it.owner}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {a.follow_ups.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="text-muted-foreground size-4" />
                Follow-ups
                <span className="text-muted-foreground text-xs font-normal">
                  · {a.follow_ups.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {a.follow_ups.map((f, i) => (
                  <li key={i} className="text-sm leading-snug">
                    <span className="font-medium">{f.task}</span>
                    {f.follow_up_by ? (
                      <span className="text-muted-foreground"> · due {f.follow_up_by}</span>
                    ) : null}
                    {f.rationale ? (
                      <p className="text-muted-foreground mt-0.5 text-xs italic">
                        {f.rationale}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {a.decisions.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="text-muted-foreground size-4" />
                Decisions
                <span className="text-muted-foreground text-xs font-normal">
                  · {a.decisions.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {a.decisions.map((d, i) => (
                  <li key={i} className="text-sm leading-snug">
                    <span className="font-medium">{d.text}</span>
                    {d.context ? (
                      <p className="text-muted-foreground mt-0.5 text-xs italic">
                        {d.context}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {a.key_quotes.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Quote className="text-muted-foreground size-4" />
                Key quotes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {a.key_quotes.map((q, i) => (
                  <li key={i} className="border-l-2 border-zinc-300 pl-3 text-sm italic dark:border-zinc-600">
                    {q.text}
                    <div className="text-muted-foreground mt-0.5 text-xs not-italic">
                      — {q.speaker}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {chat ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="text-muted-foreground size-4" />
                Chat
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                Conversation saved from the &ldquo;Chat with call&rdquo;
                panel in Process Call. Persists as the{" "}
                <code className="bg-muted rounded px-1 font-mono text-[11px]">
                  ## Chat
                </code>{" "}
                section in this note&apos;s markdown file — subsequent
                saves replace it in full.
              </p>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown source={chat} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {transcript ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Transcript</CardTitle>
              <p className="text-muted-foreground text-xs">
                Stored verbatim from the import. Reprocess re-runs the agent against this text.
              </p>
            </CardHeader>
            <CardContent>
              <pre className="text-foreground/90 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                {transcript}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-muted-foreground text-xs">
          Saved at <code className="bg-muted rounded px-1">{note.relative_path}</code>
          {" · "}analyzed {note.analyzed_at.slice(0, 16).replace("T", " ")}
        </p>
      </PageShell>
    </>
  );
}
