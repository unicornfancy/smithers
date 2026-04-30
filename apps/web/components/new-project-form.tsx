"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { createProjectAction } from "@/app/projects/new/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Kind = "partner" | "team" | "personal";
type Status =
  | "active"
  | "hot"
  | "secondary"
  | "cold"
  | "at-risk"
  | "launched"
  | "research"
  | "planning";

interface FormState {
  name: string;
  slug: string;
  kind: Kind;
  status: Status;
  partner_slug: string;
  linear_url: string;
  github_input: string;
  primary_slack_channel: string;
  team_slack_channel: string;
  zendesk_tickets_text: string;
  p2_url: string;
  nda: boolean;
  tags_csv: string;
  next_nudge: string;
}

const initial: FormState = {
  name: "",
  slug: "",
  kind: "partner",
  status: "active",
  partner_slug: "",
  linear_url: "",
  github_input: "",
  primary_slack_channel: "",
  team_slack_channel: "",
  zendesk_tickets_text: "",
  p2_url: "",
  nda: false,
  tags_csv: "",
  next_nudge: "",
};

export function NewProjectForm() {
  const router = useRouter();
  const [state, setState] = useState<FormState>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const derivedSlug = useMemo(() => {
    if (state.slug.trim()) return state.slug.trim();
    return slugify(state.name || "");
  }, [state.name, state.slug]);

  const previewYaml = useMemo(
    () => buildPreviewYaml({ ...state, derived_slug: derivedSlug }),
    [state, derivedSlug],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function submit() {
    setError(null);
    if (!state.name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (state.kind === "partner" && !state.partner_slug.trim()) {
      setError(
        "Partner slug is required for kind=partner — it determines the Hive Mind directory.",
      );
      return;
    }
    startTransition(async () => {
      const result = await createProjectAction({
        name: state.name,
        slug: state.slug || undefined,
        kind: state.kind,
        status: state.status,
        partner_slug: state.partner_slug || undefined,
        linear_url: state.linear_url || undefined,
        github_input: state.github_input || undefined,
        primary_slack_channel: state.primary_slack_channel || undefined,
        team_slack_channel: state.team_slack_channel || undefined,
        zendesk_tickets_text: state.zendesk_tickets_text || undefined,
        p2_url: state.p2_url || undefined,
        nda: state.nda,
        tags_csv: state.tags_csv || undefined,
        next_nudge: state.next_nudge || undefined,
      });
      if (!result.ok || !result.slug) {
        setError(result.error ?? "Failed to create project");
        toast.error(result.error ?? "Failed to create project");
        return;
      }
      toast.success(`Created ${state.name}`);
      router.push(`/projects/${result.slug}`);
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-base">Required</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Project name" hint="Use Team51's Partner | Scope convention if it fits.">
            <input
              type="text"
              className={inputClass}
              value={state.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="The Pocket NYC | Phase 2 Design"
              autoFocus
            />
          </Field>
          <Field
            label="Slug"
            hint={
              state.slug
                ? "Override; will be used verbatim."
                : `Auto-derived: ${derivedSlug || "(empty)"}`
            }
          >
            <input
              type="text"
              className={inputClass}
              value={state.slug}
              onChange={(e) => update("slug", e.target.value)}
              placeholder={derivedSlug}
            />
          </Field>
          <Field label="Kind">
            <select
              className={inputClass}
              value={state.kind}
              onChange={(e) => update("kind", e.target.value as Kind)}
            >
              <option value="partner">partner — external client</option>
              <option value="team">team — internal initiative</option>
              <option value="personal">personal — your own work</option>
            </select>
          </Field>
          {state.kind === "partner" ? (
            <Field
              label="Partner slug"
              hint="kebab-case; matches Hive Mind directory name (e.g. the-pocket-nyc)"
            >
              <input
                type="text"
                className={inputClass}
                value={state.partner_slug}
                onChange={(e) => update("partner_slug", e.target.value)}
                placeholder="the-pocket-nyc"
              />
            </Field>
          ) : null}
          <Field label="Status">
            <select
              className={inputClass}
              value={state.status}
              onChange={(e) => update("status", e.target.value as Status)}
            >
              <option value="hot">🔴 hot</option>
              <option value="active">🟡 active</option>
              <option value="secondary">⚪ secondary</option>
              <option value="cold">🔵 cold</option>
              <option value="at-risk">at-risk</option>
              <option value="launched">launched</option>
              <option value="research">research</option>
              <option value="planning">planning</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-base">Live Activity sources (all optional)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Linear URL" hint="Pulls slug + project id from the URL">
            <input
              type="text"
              className={inputClass}
              value={state.linear_url}
              onChange={(e) => update("linear_url", e.target.value)}
              placeholder="https://linear.app/a8c/project/..."
            />
          </Field>
          <Field label="GitHub repo" hint="URL or owner/repo shorthand">
            <input
              type="text"
              className={inputClass}
              value={state.github_input}
              onChange={(e) => update("github_input", e.target.value)}
              placeholder="a8cteam51/pocket-nyc"
            />
          </Field>
          <Field
            label="Primary Slack channel"
            hint="Channel name; with or without #"
          >
            <input
              type="text"
              className={inputClass}
              value={state.primary_slack_channel}
              onChange={(e) =>
                update("primary_slack_channel", e.target.value)
              }
              placeholder="pocket-nyc-foundation"
            />
          </Field>
          <Field
            label="Zendesk threads"
            hint="One per line. Raw IDs (11134851) or full URLs both work. The first line is treated as the primary thread."
          >
            <textarea
              className={`${inputClass} h-24 py-2`}
              value={state.zendesk_tickets_text}
              onChange={(e) =>
                update("zendesk_tickets_text", e.target.value)
              }
              placeholder={`11134851\nhttps://automattic.zendesk.com/agent/tickets/12000123`}
            />
          </Field>
          <Field label="P2 URL">
            <input
              type="text"
              className={inputClass}
              value={state.p2_url}
              onChange={(e) => update("p2_url", e.target.value)}
              placeholder="https://team51.wordpress.com/..."
            />
          </Field>
          <Field
            label="Tags"
            hint="Comma-separated; appear on the workbench header"
          >
            <input
              type="text"
              className={inputClass}
              value={state.tags_csv}
              onChange={(e) => update("tags_csv", e.target.value)}
              placeholder="events, nyc"
            />
          </Field>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.nda}
                onChange={(e) => update("nda", e.target.checked)}
              />
              NDA partner
            </label>
            {state.status === "cold" ? (
              <Field
                label="Next nudge (optional)"
                hint="ISO date for the seasonal touchpoint reminder"
              >
                <input
                  type="date"
                  className={inputClass}
                  value={state.next_nudge}
                  onChange={(e) => update("next_nudge", e.target.value)}
                />
              </Field>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <p className="text-muted-foreground text-xs">
            Frontmatter that will be written to{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
              Projects/{state.name || "<name>"}.md
            </code>
            . You can edit the file directly afterwards if you want to add fields the form doesn&rsquo;t expose.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="bg-muted overflow-auto rounded p-3 text-[11px] leading-relaxed">
            {previewYaml}
          </pre>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={pending} className="gap-1.5">
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Create project
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/projects")}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
    <label className="flex flex-col gap-1">
      <span className="text-foreground text-xs font-medium">{label}</span>
      {children}
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

interface PreviewState extends FormState {
  derived_slug: string;
}

/**
 * Render the same YAML the server will write, so the user sees exactly
 * what's about to land. Pure string assembly — keep in sync with
 * buildProjectFrontmatterFromForm on the server.
 */
function buildPreviewYaml(s: PreviewState): string {
  const lines: string[] = ["---"];
  lines.push(`slug: ${s.derived_slug || "<derived from name>"}`);
  lines.push(`name: ${s.name || "<name>"}`);
  lines.push(`kind: ${s.kind}`);
  lines.push(`status: ${s.status}`);
  if (s.kind === "partner" && s.partner_slug.trim()) {
    lines.push(`partner: ${s.partner_slug.trim()}`);
  }

  const linearParsed = previewLinear(s.linear_url);
  if (linearParsed.linear_project_slug) {
    lines.push(`linear_project_slug: ${linearParsed.linear_project_slug}`);
  }
  if (linearParsed.linear_project_id) {
    lines.push(`linear_project_id: ${linearParsed.linear_project_id}`);
  }
  const githubRepo = previewGithub(s.github_input);
  if (githubRepo) lines.push(`github_repo: ${githubRepo}`);
  if (s.primary_slack_channel.trim()) {
    const ch = s.primary_slack_channel.trim().replace(/^#/, "");
    lines.push(`primary_slack_channel: ${ch}`);
  }
  if (s.team_slack_channel.trim()) {
    const ch = s.team_slack_channel.trim().replace(/^#/, "");
    lines.push(`team_slack_channel: ${ch}`);
  }
  const tickets = s.zendesk_tickets_text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tickets.length > 0) {
    lines.push("zendesk_tickets:");
    for (const t of tickets) {
      lines.push(`  - "${t.replace(/"/g, '\\"')}"`);
    }
  }
  if (s.p2_url.trim()) lines.push(`p2_url: ${s.p2_url.trim()}`);
  if (s.nda) lines.push(`nda: true`);
  if (s.next_nudge.trim()) lines.push(`next_nudge: ${s.next_nudge.trim()}`);
  const tags = s.tags_csv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length > 0) {
    lines.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${s.name || "<name>"}`);
  return lines.join("\n");
}

function previewLinear(url: string): {
  linear_project_slug?: string;
  linear_project_id?: string;
} {
  const trimmed = url.trim();
  if (!trimmed) return {};
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {};
  }
  if (!parsed.hostname.endsWith("linear.app")) return {};
  const parts = parsed.pathname.split("/").filter(Boolean);
  const projectIdx = parts.indexOf("project");
  if (projectIdx === -1) return {};
  const slugSegment = parts[projectIdx + 1];
  if (!slugSegment) return {};
  const match = slugSegment.match(/^(.+)-([0-9a-f]{12})$/);
  if (match) {
    return { linear_project_slug: match[1], linear_project_id: match[2] };
  }
  return { linear_project_slug: slugSegment };
}

function previewGithub(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed.hostname.endsWith("github.com")) return undefined;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  return `${parts[0]}/${parts[1]!.replace(/\.git$/, "")}`;
}
