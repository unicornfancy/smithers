"use client";

import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { addFathomSearchTermAction } from "@/app/calls/actions";
import type { CallRow } from "@/app/calls/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  matched: CallRow[];
  unmatched: CallRow[];
  projectPicker: { slug: string; name: string }[];
}

export function CallsTable({ matched, unmatched, projectPicker }: Props) {
  const [pickerRow, setPickerRow] = useState<CallRow | null>(null);

  return (
    <div className="space-y-8">
      {unmatched.length > 0 ? (
        <section>
          <h2 className="text-muted-foreground mb-3 text-sm font-medium uppercase tracking-wide">
            Unmatched ({unmatched.length})
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            These recordings didn&apos;t match any project. Match one to a project
            to teach Smithers the partner&apos;s contact name or domain — future
            calls will route automatically.
          </p>
          <RecordingList rows={unmatched} onMatch={setPickerRow} />
        </section>
      ) : null}

      {matched.length > 0 ? (
        <section>
          <h2 className="text-muted-foreground mb-3 text-sm font-medium uppercase tracking-wide">
            Matched ({matched.length})
          </h2>
          <RecordingList rows={matched} />
        </section>
      ) : null}

      <MatchToProjectDialog
        row={pickerRow}
        projects={projectPicker}
        onClose={() => setPickerRow(null)}
      />
    </div>
  );
}

function RecordingList({
  rows,
  onMatch,
}: {
  rows: CallRow[];
  onMatch?: (row: CallRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Recording</th>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-left font-medium">Match</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.recording.recording_id} className="border-t align-top">
              <td className="px-3 py-2">
                <div className="font-medium">
                  {row.recording.title ?? "(untitled)"}
                </div>
                {row.recording.attendees ? (
                  <div className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                    {row.recording.attendees}
                  </div>
                ) : null}
              </td>
              <td className="text-muted-foreground whitespace-nowrap px-3 py-2 text-xs">
                {formatDate(row.recording.recorded_at)}
              </td>
              <td className="px-3 py-2">
                {row.matchedProjects.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {row.matchedProjects.map((p) => (
                      <Link
                        key={p.slug}
                        href={`/projects/${p.slug}`}
                        className="hover:no-underline"
                      >
                        <Badge variant="secondary" className="font-normal">
                          {p.name}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-2">
                  {row.recording.source_url ? (
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2 text-xs"
                    >
                      <a
                        href={row.recording.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Fathom <ExternalLink className="size-3" />
                      </a>
                    </Button>
                  ) : null}
                  {onMatch ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => onMatch(row)}
                    >
                      Match to project
                    </Button>
                  ) : row.matchedProjects[0] ? (
                    <Button asChild size="sm" variant="ghost" className="h-7">
                      <Link href={`/projects/${row.matchedProjects[0].slug}`}>
                        Open <ArrowRight className="ml-1 size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchToProjectDialog({
  row,
  projects,
  onClose,
}: {
  row: CallRow | null;
  projects: { slug: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [projectSlug, setProjectSlug] = useState("");
  const [term, setTerm] = useState("");

  // Reset form when row changes.
  if (row && !projectSlug && !term) {
    // Pre-fill the search term from the most distinctive piece of the
    // recording — prefer an attendee email's domain if present, then
    // fall back to the title's first non-trivial chunk.
    const candidate = pickInitialTerm(row);
    if (candidate) setTerm(candidate);
  }

  function reset() {
    setProjectSlug("");
    setTerm("");
  }

  function submit() {
    if (!row || !projectSlug || !term.trim() || pending) return;
    startTransition(async () => {
      try {
        const result = await addFathomSearchTermAction(projectSlug, term);
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
        toast.success("Matched — future calls will route automatically");
        reset();
        onClose();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Match failed");
      }
    });
  }

  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match to project</DialogTitle>
        </DialogHeader>
        {row ? (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Recording:</span>{" "}
              <span className="font-medium">
                {row.recording.title ?? "(untitled)"}
              </span>
            </div>
            {row.recording.attendees ? (
              <div className="text-muted-foreground text-xs">
                Attendees: {row.recording.attendees}
              </div>
            ) : null}

            <div>
              <label className="block text-xs">Project</label>
              <select
                value={projectSlug}
                onChange={(e) => setProjectSlug(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— select —</option>
                {projects.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs">Search term to add</label>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="partner contact name, email domain, etc."
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <p className="text-muted-foreground mt-1 text-xs">
                Saved to the project&apos;s <code>fathom_search_terms</code>{" "}
                frontmatter. The matcher checks against title + attendees, so
                short fragments (e.g. <code>thepocketnyc</code>,{" "}
                <code>Martin</code>) work.
              </p>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!projectSlug || !term.trim() || pending}
          >
            {pending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Save match
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function pickInitialTerm(row: CallRow): string | undefined {
  // Prefer an email's host (e.g. "thepocketnyc.com") since that's the
  // most distinctive partner identifier. Fall back to the first
  // attendee name.
  if (row.recording.attendees) {
    const emailMatch = row.recording.attendees.match(/[\w.-]+@([\w.-]+)/);
    if (emailMatch) {
      const host = emailMatch[1]!;
      // Strip the TLD for a cleaner match (thepocketnyc.com → thepocketnyc).
      return host.split(".")[0] ?? host;
    }
  }
  return undefined;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
