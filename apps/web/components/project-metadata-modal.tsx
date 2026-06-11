"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDownLeft,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import type { LinearProjectMetadata } from "@smithers/mcp-client";
import type { Project, ProjectKind, ProjectStatus } from "@smithers/vault";

import { parseLinearProjectUrl } from "@/lib/linear-url";

import {
  fetchLinearProjectMetadataAction,
  updateProjectMetadataAction,
} from "@/app/projects/[slug]/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  project: Project;
}

const KIND_OPTIONS: ProjectKind[] = ["partner", "team", "personal"];
const STATUS_OPTIONS: ProjectStatus[] = [
  "research",
  "planning",
  "active",
  "hot",
  "secondary",
  "cold",
  "at-risk",
  "launched",
  "archived",
];

interface FormState {
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  partner: string;
  github_repo: string;
  dev_url: string;
  staging_url: string;
  production_url: string;
  figma_url: string;
  linear_project_id: string;
  linear_project_slug: string;
  p2_url: string;
  slack_channel: string;
  next_nudge: string;
  nda: boolean;
  tags_csv: string;
}

function projectToFormState(p: Project): FormState {
  return {
    name: p.name,
    kind: p.kind,
    status: p.status,
    partner: p.partner ?? "",
    github_repo: p.github_repo ?? "",
    dev_url: p.dev_url ?? "",
    staging_url: p.staging_url ?? "",
    production_url: p.production_url ?? "",
    figma_url: p.figma_url ?? "",
    linear_project_id: p.linear_project_id ?? "",
    linear_project_slug: p.linear_project_slug ?? "",
    p2_url: p.p2_url ?? "",
    slack_channel: p.slack_channel ?? "",
    next_nudge: p.next_nudge ?? "",
    nda: p.nda ?? false,
    tags_csv: (p.tags ?? []).join(", "),
  };
}

function formStateToPatch(s: FormState, original: FormState) {
  // Send only fields the user changed. Empty strings clear the
  // corresponding frontmatter key on the vault side.
  const patch: Record<string, unknown> = {};
  function diffString(key: keyof FormState) {
    if (s[key] !== original[key]) {
      patch[key] = s[key];
    }
  }
  diffString("name");
  if (s.kind !== original.kind) patch["kind"] = s.kind;
  if (s.status !== original.status) patch["status"] = s.status;
  diffString("partner");
  diffString("github_repo");
  diffString("dev_url");
  diffString("staging_url");
  diffString("production_url");
  diffString("figma_url");
  diffString("linear_project_id");
  diffString("linear_project_slug");
  diffString("p2_url");
  diffString("slack_channel");
  diffString("next_nudge");
  if (s.nda !== original.nda) patch["nda"] = s.nda;
  if (s.tags_csv !== original.tags_csv) {
    patch["tags"] = s.tags_csv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return patch;
}

/** Map Linear's project state to a Smithers status. Best-effort suggestion. */
function suggestStatusFromLinear(state: string | undefined): ProjectStatus | null {
  if (!state) return null;
  switch (state.toLowerCase()) {
    case "backlog":
      return "research";
    case "planned":
      return "planning";
    case "started":
    case "in progress":
      return "active";
    case "paused":
      return "cold";
    case "completed":
      return "launched";
    case "canceled":
      return "archived";
    default:
      return null;
  }
}

export function ProjectMetadataModal({ project }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const initialState = React.useMemo(() => projectToFormState(project), [project]);
  const [state, setState] = React.useState<FormState>(initialState);
  const [pending, startTransition] = React.useTransition();
  const [linearMeta, setLinearMeta] =
    React.useState<LinearProjectMetadata | null>(null);
  const [linearStatus, setLinearStatus] = React.useState<
    "idle" | "loading" | "ready" | "missing" | "error"
  >("idle");

  // Re-seed the form whenever the modal opens or the project prop
  // changes (i.e. after a save + revalidate cycle).
  React.useEffect(() => {
    if (open) setState(projectToFormState(project));
  }, [open, project]);

  // Lazy-load Linear data on first open. Refetched on demand via
  // the Refresh button in the sidebar.
  React.useEffect(() => {
    if (!open) return;
    if (linearStatus !== "idle") return;
    if (!project.linear_project_id && !project.linear_project_slug) {
      setLinearStatus("missing");
      return;
    }
    setLinearStatus("loading");
    fetchLinearProjectMetadataAction(project.slug)
      .then((m) => {
        setLinearMeta(m);
        setLinearStatus(m ? "ready" : "error");
      })
      .catch(() => setLinearStatus("error"));
  }, [open, project, linearStatus]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    const patch = formStateToPatch(state, initialState);
    if (Object.keys(patch).length === 0) {
      toast.info("Nothing to save");
      setOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        const r = await updateProjectMetadataAction(project.slug, patch);
        if (r.changed) {
          toast.success(
            `Updated ${Object.keys(patch).length} field${Object.keys(patch).length === 1 ? "" : "s"}`,
          );
        } else {
          toast.info("No change applied");
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save changes",
        );
      }
    });
  }

  function refetchLinear() {
    setLinearStatus("loading");
    fetchLinearProjectMetadataAction(project.slug)
      .then((m) => {
        setLinearMeta(m);
        setLinearStatus(m ? "ready" : "error");
      })
      .catch(() => setLinearStatus("error"));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          title="Edit project metadata"
        >
          <Pencil className="size-3" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit project metadata</DialogTitle>
          <DialogDescription>
            Updates the YAML frontmatter in{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
              {project.source.relative_path}
            </code>
            . Empty fields clear the value. Linear column shows what&rsquo;s
            currently in Linear so you can pull individual fields over.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_220px] gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            className="flex flex-col gap-3"
          >
            <Field label="Name">
              <Input
                value={state.name}
                onChange={(v) => update("name", v)}
                disabled={pending}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind">
                <Select
                  value={state.kind}
                  onChange={(v) => update("kind", v as ProjectKind)}
                  options={KIND_OPTIONS}
                  disabled={pending}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={state.status}
                  onChange={(v) => update("status", v as ProjectStatus)}
                  options={STATUS_OPTIONS}
                  disabled={pending}
                />
              </Field>
            </div>
            <Field label="Partner slug" hint="kebab-case, e.g. the-pocket-nyc">
              <Input
                value={state.partner}
                onChange={(v) => update("partner", v)}
                disabled={pending}
              />
            </Field>
            <Field label="GitHub repo" hint="owner/name">
              <Input
                value={state.github_repo}
                onChange={(v) => update("github_repo", v)}
                disabled={pending}
              />
            </Field>
            <Field
              label="Linear project URL"
              hint="Paste the full URL — id and slug are filled in below automatically"
            >
              <Input
                value=""
                placeholder="https://linear.app/<workspace>/project/<slug>"
                onChange={(v) => {
                  const parsed = parseLinearProjectUrl(v);
                  if (!parsed) return;
                  if (parsed.id) update("linear_project_id", parsed.id);
                  update("linear_project_slug", parsed.slug);
                }}
                disabled={pending}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Linear project id">
                <Input
                  value={state.linear_project_id}
                  onChange={(v) => update("linear_project_id", v)}
                  disabled={pending}
                />
              </Field>
              <Field label="Linear slug">
                <Input
                  value={state.linear_project_slug}
                  onChange={(v) => update("linear_project_slug", v)}
                  disabled={pending}
                />
              </Field>
            </div>
            <Field label="Dev URL">
              <Input
                value={state.dev_url}
                onChange={(v) => update("dev_url", v)}
                disabled={pending}
              />
            </Field>
            <Field label="Staging URL">
              <Input
                value={state.staging_url}
                onChange={(v) => update("staging_url", v)}
                disabled={pending}
              />
            </Field>
            <Field label="Production URL">
              <Input
                value={state.production_url}
                onChange={(v) => update("production_url", v)}
                disabled={pending}
              />
            </Field>
            <Field label="Figma URL">
              <Input
                value={state.figma_url}
                onChange={(v) => update("figma_url", v)}
                disabled={pending}
              />
            </Field>
            <Field label="P2 URL">
              <Input
                value={state.p2_url}
                onChange={(v) => update("p2_url", v)}
                disabled={pending}
              />
            </Field>
            <Field label="Slack channel" hint="#channel-name">
              <Input
                value={state.slack_channel}
                onChange={(v) => update("slack_channel", v)}
                disabled={pending}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Next nudge" hint="YYYY-MM-DD">
                <Input
                  value={state.next_nudge}
                  onChange={(v) => update("next_nudge", v)}
                  disabled={pending}
                  type="date"
                />
              </Field>
              <Field label="Tags" hint="comma-separated">
                <Input
                  value={state.tags_csv}
                  onChange={(v) => update("tags_csv", v)}
                  disabled={pending}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.nda}
                onChange={(e) => update("nda", e.target.checked)}
                disabled={pending}
              />
              NDA in place
            </label>
          </form>

          <LinearSidebar
            status={linearStatus}
            meta={linearMeta}
            currentForm={state}
            onApplyName={(v) => update("name", v)}
            onApplyStatus={(v) => update("status", v)}
            onApplyNextNudge={(v) => update("next_nudge", v)}
            onApplyLinearSlug={(v) => update("linear_project_slug", v)}
            onApplyLinearId={(v) => update("linear_project_id", v)}
            onRefetch={refetchLinear}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={handleSave}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <div className="flex flex-col gap-1">
      <label className="text-foreground text-xs font-medium">
        {label}
        {hint ? (
          <span className="text-muted-foreground/80 ml-1.5 font-normal">
            {hint}
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  disabled,
  type,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "border-input bg-background focus-visible:ring-ring",
        "h-8 rounded-md border px-2.5 text-sm",
        "focus-visible:outline-none focus-visible:ring-1",
        "disabled:opacity-60",
      )}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "border-input bg-background focus-visible:ring-ring",
        "h-8 rounded-md border px-2 text-sm",
        "focus-visible:outline-none focus-visible:ring-1",
        "disabled:opacity-60",
      )}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function LinearSidebar({
  status,
  meta,
  currentForm,
  onApplyName,
  onApplyStatus,
  onApplyNextNudge,
  onApplyLinearSlug,
  onApplyLinearId,
  onRefetch,
}: {
  status: "idle" | "loading" | "ready" | "missing" | "error";
  meta: LinearProjectMetadata | null;
  currentForm: FormState;
  onApplyName: (v: string) => void;
  onApplyStatus: (v: ProjectStatus) => void;
  onApplyNextNudge: (v: string) => void;
  onApplyLinearSlug: (v: string) => void;
  onApplyLinearId: (v: string) => void;
  onRefetch: () => void;
}) {
  return (
    <aside className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/30 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
          From Linear
        </span>
        {status === "ready" || status === "error" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefetch}
            className="ml-auto h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            title="Refresh from Linear"
          >
            <RefreshCw className="size-3" />
          </Button>
        ) : null}
      </div>

      {status === "missing" ? (
        <p className="text-muted-foreground text-[11px] italic">
          No Linear project id or slug configured. Add one in the form to
          enable sync.
        </p>
      ) : status === "loading" ? (
        <p className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
          <Loader2 className="size-3 animate-spin" />
          Loading…
        </p>
      ) : status === "error" || !meta ? (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span>
            Couldn&rsquo;t load Linear data. Check that the id/slug is
            correct and try Refresh.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-[11px]">
          {meta.url ? (
            <a
              href={meta.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              Open in Linear
              <ExternalLink className="size-2.5" />
            </a>
          ) : null}

          <LinearField
            label="Name"
            value={meta.name}
            different={meta.name !== currentForm.name}
            onApply={() => onApplyName(meta.name)}
          />
          {meta.id ? (
            <LinearField
              label="ID"
              value={meta.id}
              mono
              different={meta.id !== currentForm.linear_project_id}
              onApply={() => onApplyLinearId(meta.id)}
            />
          ) : null}
          {meta.slug ? (
            <LinearField
              label="Slug"
              value={meta.slug}
              mono
              different={meta.slug !== currentForm.linear_project_slug}
              onApply={() => onApplyLinearSlug(meta.slug!)}
            />
          ) : null}
          {meta.state ? (
            <LinearField
              label="State"
              value={meta.state}
              note={
                suggestStatusFromLinear(meta.state)
                  ? `→ ${suggestStatusFromLinear(meta.state)}`
                  : undefined
              }
              different={
                suggestStatusFromLinear(meta.state) !== null &&
                suggestStatusFromLinear(meta.state) !== currentForm.status
              }
              onApply={() => {
                const mapped = suggestStatusFromLinear(meta.state);
                if (mapped) onApplyStatus(mapped);
              }}
            />
          ) : null}
          {meta.target_date ? (
            <LinearField
              label="Target"
              value={meta.target_date}
              different={meta.target_date !== currentForm.next_nudge}
              onApply={() => onApplyNextNudge(meta.target_date!)}
            />
          ) : null}
          {meta.lead ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground/70 uppercase tracking-wide">
                Lead
              </span>
              <span className="text-foreground">{meta.lead}</span>
            </div>
          ) : null}
          {meta.health ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground/70 uppercase tracking-wide">
                Health
              </span>
              <span
                className={
                  meta.health === "onTrack"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : meta.health === "atRisk"
                      ? "text-amber-700 dark:text-amber-400"
                      : meta.health === "offTrack"
                        ? "text-rose-700 dark:text-rose-400"
                        : "text-foreground"
                }
              >
                {meta.health === "onTrack"
                  ? "On track"
                  : meta.health === "atRisk"
                    ? "At risk"
                    : meta.health === "offTrack"
                      ? "Off track"
                      : meta.health}
              </span>
            </div>
          ) : null}
          {meta.progress !== undefined ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground/70 uppercase tracking-wide">
                  Progress
                </span>
                <span className="text-foreground tabular-nums">
                  {meta.progress}%
                </span>
              </div>
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, meta.progress)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function LinearField({
  label,
  value,
  note,
  different,
  mono,
  onApply,
}: {
  label: string;
  value: string;
  note?: string;
  different: boolean;
  mono?: boolean;
  onApply: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground/70 uppercase tracking-wide">
        {label}
      </span>
      <div className="flex items-start gap-1">
        <span
          className={cn(
            "min-w-0 flex-1 break-words",
            different ? "text-foreground" : "text-muted-foreground",
            mono && "font-mono",
          )}
        >
          {value}
          {note ? (
            <span className="text-muted-foreground/80 ml-1">{note}</span>
          ) : null}
        </span>
        {different ? (
          <button
            type="button"
            onClick={onApply}
            title="Use this value"
            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
          >
            <ArrowDownLeft className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
