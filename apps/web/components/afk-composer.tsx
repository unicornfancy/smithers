"use client";

import * as React from "react";
import { CalendarOff, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

import { generateAfkPostAction } from "@/app/afk/actions";
import type { ComposeAfkNotesOutput } from "@smithers/agents";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

interface Props {
  projectCount: number;
  projectNames: string[];
  authorName: string;
}

const STORAGE_KEY = "smithers:afk:last-handle";

/**
 * Single-page form for the AFK handoff composer. Captures dates +
 * coverage handle + optional intro, calls generateAfkPostAction, then
 * opens AiDraftDialog with the resulting markdown for the user to copy
 * into a P2 post. No save-to-vault — the post belongs on P2, not in the
 * vault.
 *
 * The coverage handle is persisted to localStorage so repeat sessions
 * pre-fill the same name; everything else resets per visit since dates
 * and intros change every PTO.
 */
export function AfkComposer({ projectCount, projectNames, authorName }: Props) {
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [coverageHandle, setCoverageHandle] = React.useState("");
  const [introNotes, setIntroNotes] = React.useState("");
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<ComposeAfkNotesOutput | null>(null);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setCoverageHandle(saved);
    } catch {
      /* swallow */
    }
  }, []);

  function persistHandle(value: string) {
    try {
      if (value.trim()) window.localStorage.setItem(STORAGE_KEY, value.trim());
    } catch {
      /* swallow */
    }
  }

  function generate() {
    if (pending) return;
    if (!startDate || !endDate) {
      toast.error("Pick a start and end date");
      return;
    }
    if (!coverageHandle.trim()) {
      toast.error("Coverage handle is required");
      return;
    }
    persistHandle(coverageHandle);
    start(async () => {
      try {
        const r = await generateAfkPostAction({
          start_date: startDate,
          end_date: endDate,
          coverage_handle: coverageHandle,
          intro_notes: introNotes || undefined,
        });
        if (r.ok) {
          setData(r.data);
          setOpen(true);
        } else if (r.reason === "not-configured") {
          toast.error(
            "Set ANTHROPIC_API_KEY in .env.local to enable AI drafts",
          );
        } else {
          toast.error(r.message ?? "Couldn't draft AFK post");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't draft AFK post",
        );
      }
    });
  }

  async function regenerate(intent: string) {
    // The agent doesn't take a separate intent; piggy-back by
    // appending to intro_notes so the user can iterate on the
    // intro voice without losing the rest of the form state.
    await new Promise<void>((resolve) =>
      start(async () => {
        try {
          const combinedIntro = intent.trim()
            ? `${introNotes}\n\n${intent.trim()}`.trim()
            : introNotes;
          const r = await generateAfkPostAction({
            start_date: startDate,
            end_date: endDate,
            coverage_handle: coverageHandle,
            intro_notes: combinedIntro || undefined,
          });
          if (r.ok) setData(r.data);
          else toast.error(r.message ?? "Couldn't regenerate");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't regenerate",
          );
        } finally {
          resolve();
        }
      }),
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarOff className="text-muted-foreground size-4" />
            AFK handoff post
          </CardTitle>
          <CardDescription>
            Drafts a single markdown post covering{" "}
            {projectCount === 0
              ? "no active partner/team projects yet"
              : `${projectCount} active partner/team project${projectCount === 1 ? "" : "s"}`}
            . Hot / at-risk first, then active. Coverage TAM gets one
            scrollable page per AFK window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="afk-start" className="text-sm font-medium">
                Start date
              </label>
              <input
                id="afk-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="afk-end" className="text-sm font-medium">
                End date
              </label>
              <input
                id="afk-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="afk-coverage" className="text-sm font-medium">
              Coverage handle
            </label>
            <input
              id="afk-coverage"
              placeholder="@coreyk"
              value={coverageHandle}
              onChange={(e) => setCoverageHandle(e.target.value)}
              className={inputClass}
            />
            <p className="text-muted-foreground text-xs">
              Slack/P2 @-handle of the TAM covering for you. Saved between
              visits.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="afk-intro" className="text-sm font-medium">
              Intro notes (optional)
            </label>
            <textarea
              id="afk-intro"
              placeholder="Anything you'd like the agent to drop verbatim at the top — e.g. 'I'll be at a wedding with limited signal Fri-Sun.'"
              value={introNotes}
              onChange={(e) => setIntroNotes(e.target.value)}
              rows={3}
              className={cn(inputClass, "h-auto resize-y py-2")}
            />
          </div>
          {projectNames.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">
                Projects included ({projectNames.length})
              </span>
              <div className="text-muted-foreground flex flex-wrap gap-1.5 text-xs">
                {projectNames.map((n) => (
                  <span
                    key={n}
                    className="bg-muted rounded px-2 py-0.5 font-mono text-[11px]"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              onClick={generate}
              disabled={pending}
              className="gap-2"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Megaphone className="size-4" />
              )}
              {pending ? "Drafting…" : "Generate post"}
            </Button>
            <span className="text-muted-foreground text-xs">
              Drafting from {authorName || "(no name set)"}
            </span>
          </div>
        </CardContent>
      </Card>

      {data ? (
        <AiDraftDialog
          open={open}
          onOpenChange={setOpen}
          title="AFK handoff post"
          meta={`${startDate} → ${endDate} · coverage: ${coverageHandle}`}
          rationale={data.rationale}
          body={data.body}
          onRegenerate={regenerate}
          regenerating={pending}
        />
      ) : null}
    </>
  );
}
