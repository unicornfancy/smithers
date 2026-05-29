"use client";

import { Loader2, Save, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  generateProjectHandoffAction,
  saveProjectHandoffAction,
} from "@/app/projects/[slug]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  /** Pre-fill for the "Prepared by" line — usually identity.name from config. */
  defaultPreparedBy: string;
}

type Phase =
  | { kind: "inputs" }
  | { kind: "generating" }
  | { kind: "review"; markdown: string; questions: string[] }
  | { kind: "saving"; markdown: string }
  | { kind: "saved" };

/**
 * Workbench affordance for the /project-handoff Hive Mind skill. Two
 * phases: inputs (the skill's phase-4 user-context fields plus a
 * Prepared-by name) and review (edit the agent's draft, save to HM).
 * Mirrors BriefGeneratorDialog's shape; differs only in inputs +
 * destination path (`handoff-<YYYY-MM-DD>.md` at the project root).
 */
export function HandoffGeneratorDialog({
  open,
  onOpenChange,
  projectSlug,
  defaultPreparedBy,
}: Props) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "inputs" });
  const [preparedBy, setPreparedBy] = React.useState(defaultPreparedBy);
  const [locallyTrackedWork, setLocallyTrackedWork] = React.useState("");
  const [upcomingCalls, setUpcomingCalls] = React.useState("");
  const [criticalContext, setCriticalContext] = React.useState("");
  const [exclude, setExclude] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: "inputs" });
      setShowPreview(false);
    }
  }, [open]);

  async function handleGenerate() {
    setPhase({ kind: "generating" });
    const res = await generateProjectHandoffAction({
      slug: projectSlug,
      locally_tracked_work: locallyTrackedWork,
      upcoming_calls: upcomingCalls,
      critical_context: criticalContext,
      exclude,
      prepared_by: preparedBy,
    });
    if (!res.ok) {
      toast.error(res.message ?? res.reason);
      setPhase({ kind: "inputs" });
      return;
    }
    setPhase({
      kind: "review",
      markdown: res.data.markdown,
      questions: res.data.questions,
    });
  }

  async function handleSave() {
    if (phase.kind !== "review") return;
    setPhase({ kind: "saving", markdown: phase.markdown });
    const res = await saveProjectHandoffAction({
      slug: projectSlug,
      markdown: phase.markdown,
    });
    if (!res.ok) {
      toast.error(res.reason);
      setPhase({ kind: "review", markdown: phase.markdown, questions: [] });
      return;
    }
    toast.success(`Handoff saved to ${res.relative_path}`);
    setPhase({ kind: "saved" });
    onOpenChange(false);
  }

  function updateMarkdown(next: string) {
    if (phase.kind !== "review") return;
    setPhase({ ...phase, markdown: next });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <div className="flex h-full max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Generate project handoff
            </DialogTitle>
            <p className="text-muted-foreground text-xs">
              Runs <code className="bg-muted rounded px-1">/project-handoff</code>{" "}
              using the skill prompt + dependencies from your Hive Mind clone.
              Saves to{" "}
              <code className="bg-muted rounded px-1">handoff-YYYY-MM-DD.md</code>{" "}
              in the project folder.
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {phase.kind === "inputs" || phase.kind === "generating" ? (
              <InputsPhase
                preparedBy={preparedBy}
                onPreparedBy={setPreparedBy}
                locallyTrackedWork={locallyTrackedWork}
                onLocallyTrackedWork={setLocallyTrackedWork}
                upcomingCalls={upcomingCalls}
                onUpcomingCalls={setUpcomingCalls}
                criticalContext={criticalContext}
                onCriticalContext={setCriticalContext}
                exclude={exclude}
                onExclude={setExclude}
                disabled={phase.kind === "generating"}
              />
            ) : phase.kind === "review" || phase.kind === "saving" ? (
              <ReviewPhase
                markdown={phase.markdown}
                questions={
                  phase.kind === "review" ? phase.questions : []
                }
                showPreview={showPreview}
                onTogglePreview={() => setShowPreview((p) => !p)}
                onChange={updateMarkdown}
                disabled={phase.kind === "saving"}
              />
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={phase.kind === "generating" || phase.kind === "saving"}
            >
              Close
            </Button>
            {phase.kind === "inputs" || phase.kind === "generating" ? (
              <Button
                onClick={handleGenerate}
                disabled={phase.kind === "generating"}
                className="gap-1.5"
              >
                {phase.kind === "generating" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {phase.kind === "generating" ? "Generating…" : "Generate handoff"}
              </Button>
            ) : phase.kind === "review" || phase.kind === "saving" ? (
              <Button
                onClick={handleSave}
                disabled={phase.kind === "saving"}
                className="gap-1.5"
              >
                {phase.kind === "saving" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {phase.kind === "saving" ? "Saving…" : "Save to Hive Mind"}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InputsPhase(props: {
  preparedBy: string;
  onPreparedBy: (v: string) => void;
  locallyTrackedWork: string;
  onLocallyTrackedWork: (v: string) => void;
  upcomingCalls: string;
  onUpcomingCalls: (v: string) => void;
  criticalContext: string;
  onCriticalContext: (v: string) => void;
  exclude: string;
  onExclude: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-foreground mb-1 block text-sm font-medium">
          Prepared by
        </label>
        <input
          type="text"
          value={props.preparedBy}
          onChange={(e) => props.onPreparedBy(e.target.value)}
          disabled={props.disabled}
          className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1"
          placeholder="Your name"
        />
      </div>
      <Field
        label="Locally tracked work"
        hint="Anything you track outside Linear — personal notes, spreadsheets, side projects."
        value={props.locallyTrackedWork}
        onChange={props.onLocallyTrackedWork}
        disabled={props.disabled}
        rows={3}
      />
      <Field
        label="Upcoming calls / meetings"
        hint="Calls or meetings the next TAM should know about before they start."
        value={props.upcomingCalls}
        onChange={props.onUpcomingCalls}
        disabled={props.disabled}
        rows={3}
      />
      <Field
        label="Critical context for the next TAM"
        hint="Partner preferences, sensitivities, ongoing negotiations, key relationships, blockers."
        value={props.criticalContext}
        onChange={props.onCriticalContext}
        disabled={props.disabled}
        rows={4}
      />
      <Field
        label="Anything to exclude"
        hint="Information that should NOT make it into the handoff."
        value={props.exclude}
        onChange={props.onExclude}
        disabled={props.disabled}
        rows={2}
      />
      <p className="text-muted-foreground text-[11px] italic">
        Smithers pre-gathers project metadata (vault frontmatter, HM
        partner-knowledge + project info, Linear project metadata) and feeds
        those into the agent automatically. The skill&apos;s MCP-side crawl
        phases (deep Linear, P2 reader, Zendesk threads, GitHub open issues)
        aren&apos;t available in this run — anything missing comes back in
        the review under &ldquo;questions&rdquo;.
      </p>
    </div>
  );
}

function Field(props: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  rows: number;
}) {
  return (
    <div>
      <label className="text-foreground mb-0.5 block text-sm font-medium">
        {props.label}
      </label>
      <p className="text-muted-foreground mb-1 text-[11px]">{props.hint}</p>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        rows={props.rows}
        className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-md border p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1"
      />
    </div>
  );
}

function ReviewPhase(props: {
  markdown: string;
  questions: string[];
  showPreview: boolean;
  onTogglePreview: () => void;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      {props.questions.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="text-amber-900 dark:text-amber-200 font-medium">
            {props.questions.length} open question
            {props.questions.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 list-disc pl-5 text-amber-900/90 text-[13px] dark:text-amber-200/90">
            {props.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onTogglePreview}
          disabled={props.disabled}
        >
          {props.showPreview ? "Edit" : "Preview"}
        </Button>
      </div>
      {props.showPreview ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Markdown source={props.markdown} />
        </div>
      ) : (
        <textarea
          value={props.markdown}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          rows={24}
          className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-md border p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1"
        />
      )}
    </div>
  );
}
