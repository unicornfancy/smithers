"use client";

import { Image as ImageIcon, Loader2, Save, Sparkles, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  generateProjectLaunchPostAction,
  saveProjectLaunchPostAction,
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
  /** Pre-fill for the live site URL from project.site_url (frontmatter) if present. */
  defaultSiteUrl?: string;
}

type Phase =
  | { kind: "inputs" }
  | { kind: "generating" }
  | {
      kind: "review";
      markdown: string;
      questions: string[];
      launchDate: string;
      imageSlots: ImageSlot[];
    }
  | { kind: "saving"; markdown: string; launchDate: string; imageSlots: ImageSlot[] }
  | { kind: "saved" };

interface ImageSlot {
  /** kebab-case filename the markdown references, e.g. "after-show-page.png". */
  filename: string;
  /** alt text from the markdown reference, used as the slot label. */
  alt: string;
  /** the File the user picked, if any. */
  file: File | null;
}

/**
 * Workbench affordance for the /create-launch-post Hive Mind skill.
 * Three phases: inputs (launch date, site URL, P2/Linear/Slack pastes,
 * features, lessons), review (edit the draft, upload images for the
 * slots the skill referenced), save (write markdown + image bytes to
 * the project's HM folder + commit).
 *
 * Image flow: the skill emits Markdown image refs
 * `![alt](assets/launched-<date>/<filename>.png)` for every BEFORE/AFTER
 * and Development screenshot. The dialog parses those refs out of the
 * returned markdown to build the upload slots — robust regardless of
 * how the skill phrases its questions[] entries.
 */
export function LaunchPostGeneratorDialog({
  open,
  onOpenChange,
  projectSlug,
  defaultSiteUrl,
}: Props) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "inputs" });
  const [launchDate, setLaunchDate] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [siteUrl, setSiteUrl] = React.useState(defaultSiteUrl ?? "");
  const [p2Context, setP2Context] = React.useState("");
  const [linearContext, setLinearContext] = React.useState("");
  const [slackContext, setSlackContext] = React.useState("");
  const [features, setFeatures] = React.useState("");
  const [lessons, setLessons] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: "inputs" });
      setShowPreview(false);
    }
  }, [open]);

  async function handleGenerate() {
    setPhase({ kind: "generating" });
    const res = await generateProjectLaunchPostAction({
      slug: projectSlug,
      launch_date: launchDate,
      site_url: siteUrl,
      p2_context: p2Context,
      linear_context: linearContext,
      slack_context: slackContext,
      features,
      lessons,
    });
    if (!res.ok) {
      toast.error(res.message ?? res.reason);
      setPhase({ kind: "inputs" });
      return;
    }
    const slots = parseImageSlots(res.data.markdown);
    setPhase({
      kind: "review",
      markdown: res.data.markdown,
      questions: res.data.questions,
      launchDate,
      imageSlots: slots,
    });
  }

  async function handleSave() {
    if (phase.kind !== "review") return;
    setPhase({
      kind: "saving",
      markdown: phase.markdown,
      launchDate: phase.launchDate,
      imageSlots: phase.imageSlots,
    });
    const images: Array<{ filename: string; base64: string }> = [];
    for (const slot of phase.imageSlots) {
      if (!slot.file) continue;
      try {
        const base64 = await fileToBase64(slot.file);
        images.push({ filename: slot.filename, base64 });
      } catch (err) {
        toast.error(
          `Failed to read ${slot.filename}: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        setPhase({
          kind: "review",
          markdown: phase.markdown,
          questions: [],
          launchDate: phase.launchDate,
          imageSlots: phase.imageSlots,
        });
        return;
      }
    }
    const res = await saveProjectLaunchPostAction({
      slug: projectSlug,
      launch_date: phase.launchDate,
      markdown: phase.markdown,
      images,
    });
    if (!res.ok) {
      toast.error(res.reason);
      setPhase({
        kind: "review",
        markdown: phase.markdown,
        questions: [],
        launchDate: phase.launchDate,
        imageSlots: phase.imageSlots,
      });
      return;
    }
    toast.success(
      `Launch post saved to ${res.relative_path}` +
        (res.assets_written.length > 0
          ? ` (+ ${res.assets_written.length} image${res.assets_written.length === 1 ? "" : "s"})`
          : ""),
    );
    setPhase({ kind: "saved" });
    onOpenChange(false);
  }

  function updateMarkdown(next: string) {
    if (phase.kind !== "review") return;
    setPhase({ ...phase, markdown: next, imageSlots: phase.imageSlots });
  }

  function updateImageSlot(filename: string, file: File | null) {
    if (phase.kind !== "review") return;
    setPhase({
      ...phase,
      imageSlots: phase.imageSlots.map((s) =>
        s.filename === filename ? { ...s, file } : s,
      ),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <div className="flex h-full max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Generate launch post
            </DialogTitle>
            <p className="text-muted-foreground text-xs">
              Runs{" "}
              <code className="bg-muted rounded px-1">/create-launch-post</code>{" "}
              using the skill prompt + dependencies from your Hive Mind clone.
              Saves to{" "}
              <code className="bg-muted rounded px-1">
                launched-YYYY-MM-DD.md
              </code>{" "}
              in the project folder, with images written to{" "}
              <code className="bg-muted rounded px-1">assets/launched-…/</code>.
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {phase.kind === "inputs" || phase.kind === "generating" ? (
              <InputsPhase
                launchDate={launchDate}
                onLaunchDate={setLaunchDate}
                siteUrl={siteUrl}
                onSiteUrl={setSiteUrl}
                p2Context={p2Context}
                onP2Context={setP2Context}
                linearContext={linearContext}
                onLinearContext={setLinearContext}
                slackContext={slackContext}
                onSlackContext={setSlackContext}
                features={features}
                onFeatures={setFeatures}
                lessons={lessons}
                onLessons={setLessons}
                disabled={phase.kind === "generating"}
              />
            ) : phase.kind === "review" || phase.kind === "saving" ? (
              <ReviewPhase
                markdown={phase.markdown}
                questions={phase.kind === "review" ? phase.questions : []}
                imageSlots={phase.imageSlots}
                showPreview={showPreview}
                onTogglePreview={() => setShowPreview((p) => !p)}
                onChange={updateMarkdown}
                onPickImage={updateImageSlot}
                disabled={phase.kind === "saving"}
              />
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={
                phase.kind === "generating" || phase.kind === "saving"
              }
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
                {phase.kind === "generating"
                  ? "Generating…"
                  : "Generate launch post"}
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
                {phase.kind === "saving"
                  ? "Saving…"
                  : "Save to Hive Mind"}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InputsPhase(props: {
  launchDate: string;
  onLaunchDate: (v: string) => void;
  siteUrl: string;
  onSiteUrl: (v: string) => void;
  p2Context: string;
  onP2Context: (v: string) => void;
  linearContext: string;
  onLinearContext: (v: string) => void;
  slackContext: string;
  onSlackContext: (v: string) => void;
  features: string;
  onFeatures: (v: string) => void;
  lessons: string;
  onLessons: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-foreground mb-1 block text-sm font-medium">
            Launch date
          </label>
          <input
            type="date"
            value={props.launchDate}
            onChange={(e) => props.onLaunchDate(e.target.value)}
            disabled={props.disabled}
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1"
          />
          <p className="text-muted-foreground mt-1 text-[11px]">
            Drives the filename (
            <code className="bg-muted rounded px-1 font-mono text-[10px]">
              launched-{props.launchDate}.md
            </code>
            ).
          </p>
        </div>
        <div>
          <label className="text-foreground mb-1 block text-sm font-medium">
            Live site URL
          </label>
          <input
            type="url"
            value={props.siteUrl}
            onChange={(e) => props.onSiteUrl(e.target.value)}
            disabled={props.disabled}
            placeholder="https://example.com"
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1"
          />
        </div>
      </div>
      <Field
        label="P2 context (optional)"
        hint="If the project has a p2_url in frontmatter, Smithers fetches the post body and comments automatically. Paste here only when there's an additional thread (e.g. a separate launch comment) the agent should see."
        value={props.p2Context}
        onChange={props.onP2Context}
        disabled={props.disabled}
        rows={2}
      />
      <Field
        label="Linear context (optional)"
        hint="Smithers pre-fetches project metadata, recent updates, and the top-8 issues (with comments). Paste here only if there's something the agent needs that those queries won't catch."
        value={props.linearContext}
        onChange={props.onLinearContext}
        disabled={props.disabled}
        rows={2}
      />
      <Field
        label="Slack context"
        hint="Optional. Paste launch-channel highlights or partner quotes that should make it into the post."
        value={props.slackContext}
        onChange={props.onSlackContext}
        disabled={props.disabled}
        rows={3}
      />
      <Field
        label="Features to highlight"
        hint="List each feature the Development section should cover. Inline code snippets in fenced blocks if you want them surfaced."
        value={props.features}
        onChange={props.onFeatures}
        disabled={props.disabled}
        rows={4}
      />
      <Field
        label="Lessons learned + A8C product feedback"
        hint="Tips for next time + any A8C product feedback you want surfaced for product teams."
        value={props.lessons}
        onChange={props.onLessons}
        disabled={props.disabled}
        rows={3}
      />
      <p className="text-muted-foreground text-[11px] italic">
        Smithers pre-gathers project metadata (vault frontmatter, HM
        partner-knowledge + project info, Linear project metadata) and feeds
        those into the agent automatically. The skill&apos;s MCP-side crawl
        phases (live P2/Slack reads) aren&apos;t available in this run — paste
        the source material above and anything still missing comes back in the
        review under &ldquo;questions&rdquo;.
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
  imageSlots: ImageSlot[];
  showPreview: boolean;
  onTogglePreview: () => void;
  onChange: (next: string) => void;
  onPickImage: (filename: string, file: File | null) => void;
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

      {props.imageSlots.length > 0 ? (
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <p className="text-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
            <ImageIcon className="size-3.5" />
            Images ({props.imageSlots.filter((s) => s.file).length}/
            {props.imageSlots.length} picked)
          </p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Pick a file for each filename the markdown references. Files write
            to{" "}
            <code className="bg-muted rounded px-1 font-mono text-[10px]">
              assets/launched-&lt;date&gt;/
            </code>{" "}
            on save. Empty slots are skipped — you can drop them in the repo
            later.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {props.imageSlots.map((slot) => (
              <ImageSlotRow
                key={slot.filename}
                slot={slot}
                onPick={(f) => props.onPickImage(slot.filename, f)}
                disabled={props.disabled}
              />
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

function ImageSlotRow({
  slot,
  onPick,
  disabled,
}: {
  slot: ImageSlot;
  onPick: (file: File | null) => void;
  disabled: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <li className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs">
      <code className="bg-muted shrink-0 rounded px-1 py-0.5 font-mono text-[10px]">
        {slot.filename}
      </code>
      <span className="text-muted-foreground flex-1 truncate">
        {slot.alt || "(no alt text)"}
      </span>
      {slot.file ? (
        <>
          <span className="text-foreground/80 max-w-[180px] truncate">
            {slot.file.name} ({Math.round(slot.file.size / 1024)} KB)
          </span>
          <button
            type="button"
            onClick={() => onPick(null)}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear file"
          >
            <X className="size-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="text-primary hover:text-primary/80 text-[11px] underline"
        >
          Pick file
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </li>
  );
}

/**
 * Extract image slots from the skill's returned markdown. Looks for
 * `![alt](assets/launched-<date>/<filename>)` patterns — the SKILL.md
 * mandates this exact path shape for every BEFORE/AFTER and Development
 * screenshot. Deduplicates on filename and preserves first-seen order
 * so the upload list mirrors the post's narrative order.
 */
function parseImageSlots(markdown: string): ImageSlot[] {
  const re = /!\[([^\]]*)\]\(assets\/launched-\d{4}-\d{2}-\d{2}\/([^)\s]+)\)/g;
  const seen = new Map<string, ImageSlot>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const alt = m[1] ?? "";
    const filename = m[2] ?? "";
    if (!filename || seen.has(filename)) continue;
    seen.set(filename, { filename, alt, file: null });
  }
  return Array.from(seen.values());
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}
