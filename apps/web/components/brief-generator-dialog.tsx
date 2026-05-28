"use client";

import * as React from "react";
import { FileText, Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import {
  generateProjectBriefAction,
  saveProjectBriefAction,
} from "@/app/projects/[slug]/actions";

export interface TranscriptOption {
  /** HM-root-relative path. */
  path: string;
  /** Pretty title for the row. */
  title: string;
  /** YYYY-MM-DD (when known) for sort + display. */
  date: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  /** All call transcripts for this project (HM-root-relative paths). */
  transcripts: TranscriptOption[];
  /** Pre-filled from project's info.md `discovery_doc_url`. */
  initialDiscoveryDocUrl: string;
  /** Pre-filled from partner-knowledge.md `domain_registrar`. */
  initialRegistrar: string;
  /** Pre-filled from partner-knowledge.md `dns_provider`. */
  initialDns: string;
}

type Phase =
  | { kind: "inputs" }
  | { kind: "generating" }
  | { kind: "review"; markdown: string; questions: string[] }
  | { kind: "saving"; markdown: string }
  | { kind: "saved" };

export function BriefGeneratorDialog({
  open,
  onOpenChange,
  projectSlug,
  transcripts,
  initialDiscoveryDocUrl,
  initialRegistrar,
  initialDns,
}: Props) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "inputs" });
  const [selectedTranscripts, setSelectedTranscripts] = React.useState<Set<string>>(
    () => {
      // Default: most-recent transcript pre-selected, nothing else.
      const sorted = [...transcripts].sort((a, b) =>
        (b.date ?? "").localeCompare(a.date ?? ""),
      );
      return new Set(sorted[0]?.path ? [sorted[0].path] : []);
    },
  );
  const [docKind, setDocKind] = React.useState<"url" | "content">(
    initialDiscoveryDocUrl ? "url" : "url",
  );
  const [docValue, setDocValue] = React.useState(initialDiscoveryDocUrl);
  const [registrar, setRegistrar] = React.useState(initialRegistrar);
  const [dns, setDns] = React.useState(initialDns);
  const [showPreview, setShowPreview] = React.useState(false);

  // Reset when dialog closes so the next open starts from scratch.
  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: "inputs" });
      setShowPreview(false);
    }
  }, [open]);

  const inputsValid =
    selectedTranscripts.size > 0 || docValue.trim().length > 0;

  function toggleTranscript(path: string) {
    setSelectedTranscripts((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleGenerate() {
    setPhase({ kind: "generating" });
    const res = await generateProjectBriefAction({
      slug: projectSlug,
      transcript_paths: Array.from(selectedTranscripts),
      discovery_doc: { kind: docKind, value: docValue },
      domain_registrar: registrar,
      dns_provider: dns,
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
    const res = await saveProjectBriefAction({
      slug: projectSlug,
      markdown: phase.markdown,
    });
    if (!res.ok) {
      toast.error(res.reason);
      setPhase({ kind: "review", markdown: phase.markdown, questions: [] });
      return;
    }
    toast.success("Brief saved to Hive Mind");
    setPhase({ kind: "saved" });
    onOpenChange(false);
  }

  function updateReviewMarkdown(next: string) {
    if (phase.kind !== "review") return;
    setPhase({ ...phase, markdown: next });
  }

  const sortedTranscripts = React.useMemo(
    () =>
      [...transcripts].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [transcripts],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <div className="flex h-full max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Generate project brief
            </DialogTitle>
            <p className="text-muted-foreground text-xs">
              Runs <code className="bg-muted rounded px-1">/create-brief</code>{" "}
              using the skill prompt and templates from your Hive Mind clone.
              The brief lands at{" "}
              <code className="bg-muted rounded px-1">brief.md</code> in the
              project folder.
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {phase.kind === "inputs" || phase.kind === "generating" ? (
              <InputsPhase
                transcripts={sortedTranscripts}
                selectedTranscripts={selectedTranscripts}
                onToggleTranscript={toggleTranscript}
                docKind={docKind}
                docValue={docValue}
                onDocKindChange={setDocKind}
                onDocValueChange={setDocValue}
                registrar={registrar}
                onRegistrarChange={setRegistrar}
                dns={dns}
                onDnsChange={setDns}
                generating={phase.kind === "generating"}
              />
            ) : null}

            {phase.kind === "review" || phase.kind === "saving" ? (
              <ReviewPhase
                markdown={phase.markdown}
                questions={
                  phase.kind === "review" ? phase.questions : []
                }
                onChange={updateReviewMarkdown}
                showPreview={showPreview}
                onTogglePreview={() => setShowPreview((v) => !v)}
                readOnly={phase.kind === "saving"}
              />
            ) : null}
          </div>

          <DialogFooter className="border-t px-6 py-3">
            {phase.kind === "inputs" || phase.kind === "generating" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={phase.kind === "generating"}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={!inputsValid || phase.kind === "generating"}
                  className="gap-1.5"
                >
                  {phase.kind === "generating" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {phase.kind === "generating" ? "Generating…" : "Generate"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setPhase({ kind: "inputs" })}
                  disabled={phase.kind === "saving"}
                >
                  Back to inputs
                </Button>
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
                  Save to Hive Mind
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InputsPhase({
  transcripts,
  selectedTranscripts,
  onToggleTranscript,
  docKind,
  docValue,
  onDocKindChange,
  onDocValueChange,
  registrar,
  onRegistrarChange,
  dns,
  onDnsChange,
  generating,
}: {
  transcripts: TranscriptOption[];
  selectedTranscripts: Set<string>;
  onToggleTranscript: (path: string) => void;
  docKind: "url" | "content";
  docValue: string;
  onDocKindChange: (kind: "url" | "content") => void;
  onDocValueChange: (value: string) => void;
  registrar: string;
  onRegistrarChange: (value: string) => void;
  dns: string;
  onDnsChange: (value: string) => void;
  generating: boolean;
}) {
  return (
    <div className={cn("space-y-6", generating && "opacity-60")}>
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Call transcripts
        </h3>
        <p className="text-muted-foreground mb-3 text-xs">
          The skill uses raw transcript text. Pick everything that's relevant —
          the agent stitches them together.
        </p>
        {transcripts.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No call transcripts in HM for this project yet. Process a Fathom
            recording from /calls or the workbench, then come back.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {transcripts.map((t) => (
              <li key={t.path}>
                <label className="hover:bg-accent/30 flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedTranscripts.has(t.path)}
                    onChange={() => onToggleTranscript(t.path)}
                    disabled={generating}
                    className="accent-foreground"
                  />
                  <div className="flex-1">
                    <p className="text-foreground text-sm">{t.title}</p>
                    <p className="text-muted-foreground text-[11px]">
                      {t.date ?? "(undated)"} · {t.path}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Discovery Doc
        </h3>
        <p className="text-muted-foreground mb-3 text-xs">
          Either link the partner's Discovery Doc by URL (saved to
          <code className="bg-muted ml-1 rounded px-1 text-[10px]">
            info.md
          </code>{" "}
          for next time) or paste content directly.
        </p>
        <div className="mb-2 flex gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={docKind === "url"}
              onChange={() => onDocKindChange("url")}
              disabled={generating}
            />
            URL
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={docKind === "content"}
              onChange={() => onDocKindChange("content")}
              disabled={generating}
            />
            Paste content
          </label>
        </div>
        {docKind === "url" ? (
          <input
            type="text"
            value={docValue}
            onChange={(e) => onDocValueChange(e.target.value)}
            placeholder="https://docs.google.com/document/d/…"
            disabled={generating}
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1"
          />
        ) : (
          <textarea
            value={docValue}
            onChange={(e) => onDocValueChange(e.target.value)}
            placeholder="Paste the Discovery Doc content here…"
            rows={8}
            disabled={generating}
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1"
          />
        )}
      </section>

      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Domain registrar + DNS
        </h3>
        <p className="text-muted-foreground mb-3 text-xs">
          Saved to{" "}
          <code className="bg-muted rounded px-1 text-[10px]">
            partner-knowledge.md
          </code>{" "}
          so future briefs for this partner pre-fill these. Leave blank if not
          yet known and the brief will hedge.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground font-medium">Registrar</span>
            <input
              type="text"
              value={registrar}
              onChange={(e) => onRegistrarChange(e.target.value)}
              placeholder="e.g. Squarespace Domains, Cloudflare Registrar"
              disabled={generating}
              className="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground font-medium">DNS provider</span>
            <input
              type="text"
              value={dns}
              onChange={(e) => onDnsChange(e.target.value)}
              placeholder="(optional — leave blank if same as registrar)"
              disabled={generating}
              className="border-input bg-background focus-visible:ring-ring rounded-md border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function ReviewPhase({
  markdown,
  questions,
  onChange,
  showPreview,
  onTogglePreview,
  readOnly,
}: {
  markdown: string;
  questions: string[];
  onChange: (next: string) => void;
  showPreview: boolean;
  onTogglePreview: () => void;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      {questions.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-amber-900 text-xs font-medium dark:text-amber-200">
            The skill flagged follow-up questions:
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-amber-900 dark:text-amber-200">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          <FileText className="mr-1 inline-block size-3" />
          Edit freely before saving. Will overwrite the existing brief in HM.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePreview}
          className="text-xs"
        >
          {showPreview ? "Edit" : "Preview"}
        </Button>
      </div>

      {showPreview ? (
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-background p-4">
          <Markdown source={markdown} />
        </div>
      ) : (
        <textarea
          value={markdown}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          rows={24}
          className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-md border p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1"
        />
      )}
    </div>
  );
}
