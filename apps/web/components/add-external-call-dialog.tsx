"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FilePlus2,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { processExternalCallAction } from "@/app/calls/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  /** All vault projects available to pick from. Used by the global /calls callsite. */
  projects: Array<{ slug: string; name: string }>;
  /** If set, the dialog opens pre-tied to this project (no project picker shown). */
  fixedProjectSlug?: string;
  fixedProjectName?: string;
  /** Label override for the trigger button. */
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
}

/**
 * Import a call transcript from outside Smithers — Granola export
 * from a covering TAM, a Fathom share link copied as text, a Whisper
 * dump — and run it through the same analyze + save pipeline as
 * in-app processed calls. Result lands as a regular Call Notes file
 * tied to the chosen project.
 */
export function AddExternalCallDialog({
  projects,
  fixedProjectSlug,
  fixedProjectName,
  label = "Add external call",
  size = "sm",
  variant = "default",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"paste" | "upload">("paste");
  const [transcript, setTranscript] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [recordedAt, setRecordedAt] = React.useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [projectSlug, setProjectSlug] = React.useState(fixedProjectSlug ?? "");
  const [source, setSource] = React.useState("");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [pending, setPending] = React.useState(false);

  function reset() {
    setTranscript("");
    setTitle("");
    setRecordedAt(new Date().toISOString().slice(0, 10));
    setProjectSlug(fixedProjectSlug ?? "");
    setSource("");
    setSourceUrl("");
    setMode("paste");
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text().catch(() => "");
    setTranscript(text);
    if (!title) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ""));
    // Switch back to paste view so the user can see + edit the loaded text.
    setMode("paste");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transcript.trim()) {
      toast.error("Paste or upload a transcript first");
      return;
    }
    setPending(true);
    try {
      const res = await processExternalCallAction({
        transcript,
        title: title.trim() || "External call",
        recorded_at: recordedAt,
        project_slug: projectSlug || undefined,
        source: source.trim() || undefined,
        source_url: sourceUrl.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      toast.success(
        res.cached ? "Re-loaded saved analysis" : "Call analyzed and saved",
      );
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <FilePlus2 className="size-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add external call</DialogTitle>
            <DialogDescription>
              Import a transcript that didn&apos;t come from your own
              Fathom/Granola — e.g. a covering TAM sent you their Granola
              recap. Runs through the same AI analysis pipeline.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-1.5">
              <ModeButton
                active={mode === "paste"}
                onClick={() => setMode("paste")}
                icon={<FileText className="size-3.5" />}
              >
                Paste text
              </ModeButton>
              <ModeButton
                active={mode === "upload"}
                onClick={() => setMode("upload")}
                icon={<Upload className="size-3.5" />}
              >
                Upload file
              </ModeButton>
            </div>

            {mode === "paste" ? (
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the full transcript here…"
                rows={10}
                disabled={pending}
                className={cn(
                  "border-input bg-background focus-visible:ring-ring",
                  "w-full rounded-md border px-3 py-2 font-mono text-sm leading-relaxed",
                  "focus-visible:outline-none focus-visible:ring-1",
                )}
              />
            ) : (
              <div className="bg-muted/30 rounded-md border border-dashed p-4 text-center">
                <input
                  type="file"
                  accept=".txt,.md,.markdown"
                  onChange={handleFile}
                  disabled={pending}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-background hover:file:bg-foreground/90"
                />
                <p className="text-muted-foreground mt-2 text-xs">
                  Accepts <code>.txt</code> / <code>.md</code>. The file is read into the textarea so you can review before submitting.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Discovery call · Body Dao"
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
              <Field label="Recorded date">
                <input
                  type="date"
                  value={recordedAt}
                  onChange={(e) => setRecordedAt(e.target.value)}
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
            </div>

            {!fixedProjectSlug ? (
              <Field label="Project">
                <select
                  value={projectSlug}
                  onChange={(e) => setProjectSlug(e.target.value)}
                  disabled={pending}
                  className={inputCls}
                >
                  <option value="">— team / orphan (no project) —</option>
                  {projects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p className="text-muted-foreground text-xs">
                Will be associated with{" "}
                <span className="font-medium">
                  {fixedProjectName ?? fixedProjectSlug}
                </span>
                .
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Source"
                hint="Who provided it"
              >
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Granola · Bob during cover"
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
              <Field
                label="Source URL"
                hint="optional"
              >
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://…"
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !transcript.trim()}
                className="gap-1.5"
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FilePlus2 className="size-3.5" />
                )}
                Analyze + save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground flex items-baseline gap-1.5 text-xs font-medium uppercase tracking-wide">
        {label}
        {hint ? (
          <span className="text-muted-foreground/70 font-normal normal-case">
            · {hint}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background border-foreground"
          : "border-input text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

const inputCls = cn(
  "border-input bg-background focus-visible:ring-ring",
  "w-full rounded-md border px-2 py-1.5 text-sm",
  "focus-visible:outline-none focus-visible:ring-1",
);
