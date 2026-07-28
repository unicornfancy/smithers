"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { Project } from "@smithers/vault";

import {
  cloneProjectAction,
  readProjectCloneDefaultsAction,
} from "@/app/projects/[slug]/actions";
import { parseLinearProjectUrl } from "@/lib/linear-url";
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
import { cn } from "@/lib/utils";

interface Props {
  project: Project;
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-8 rounded-md border px-2 text-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

interface Tier1 {
  partner?: string;
  hive_mind_partner_slug?: string;
  kind?: string;
  nda?: boolean;
  tags?: string[];
  production_url?: string;
  slack_channel?: string;
  zendesk_search_terms?: string[];
}

interface Tier2 {
  github_repo?: string;
  staging_url?: string;
  figma_url?: string;
  google_drive_url?: string;
  p2_url?: string;
}

interface Tier2Checked {
  github_repo: boolean;
  staging_url: boolean;
  figma_url: boolean;
  google_drive_url: boolean;
  p2_url: boolean;
}

/**
 * Workbench-header action for starting a sibling project — a new phase
 * of the same partner engagement, typically. Copies tier-1 (partner
 * identity) frontmatter unconditionally, tier-2 (usually-same
 * references) with a per-field opt-out, and never copies tier-3
 * (instance-specific: zendesk_tickets, project_id, call notes,
 * personal notes, follow-ups). Optional "close out source" toggle
 * archives the old phase.
 */
export function CloneProjectDialog({ project }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [tier1, setTier1] = React.useState<Tier1>({});
  const [tier2, setTier2] = React.useState<Tier2>({});
  const [tier2Checked, setTier2Checked] = React.useState<Tier2Checked>({
    github_repo: true,
    staging_url: true,
    figma_url: true,
    google_drive_url: true,
    p2_url: true,
  });
  const [newName, setNewName] = React.useState("");
  const [newSlug, setNewSlug] = React.useState("");
  const [linearId, setLinearId] = React.useState("");
  const [linearSlug, setLinearSlug] = React.useState("");
  const [closeSource, setCloseSource] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    void readProjectCloneDefaultsAction(project.slug)
      .then((r) => {
        if (r.ok) {
          // p2_url moved from tier1 to tier2 per user preference —
          // some new phases spin up a new P2 channel.
          setTier1({
            partner: r.tier1.partner,
            hive_mind_partner_slug: r.tier1.hive_mind_partner_slug,
            kind: r.tier1.kind,
            nda: r.tier1.nda,
            tags: r.tier1.tags,
            production_url: r.tier1.production_url,
            slack_channel: r.tier1.slack_channel,
            zendesk_search_terms: r.tier1.zendesk_search_terms,
          });
          setTier2({
            github_repo: r.tier2.github_repo,
            staging_url: r.tier2.staging_url,
            figma_url: r.tier2.figma_url,
            google_drive_url: r.tier2.google_drive_url,
            p2_url: r.tier1.p2_url,
          });
          setTier2Checked({
            github_repo: Boolean(r.tier2.github_repo),
            staging_url: Boolean(r.tier2.staging_url),
            figma_url: Boolean(r.tier2.figma_url),
            google_drive_url: Boolean(r.tier2.google_drive_url),
            p2_url: Boolean(r.tier1.p2_url),
          });
        } else {
          toast.error(r.message);
        }
      })
      .finally(() => setLoading(false));
  }, [open, project.slug]);

  function autoSlug(from: string) {
    return from
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function onNameChange(v: string) {
    setNewName(v);
    // Only auto-fill slug if the user hasn't hand-edited it away from
    // the derived version — otherwise typing in the name field would
    // stomp their custom slug.
    if (!newSlug || newSlug === autoSlug(newName)) {
      setNewSlug(autoSlug(v));
    }
  }

  const nameValid = newName.trim().length > 0;
  const slugValid = /^[a-z0-9][a-z0-9-]*$/.test(newSlug.trim());
  const canSubmit = !loading && !saving && nameValid && slugValid;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const result = await cloneProjectAction(project.slug, {
        new_name: newName.trim(),
        new_slug: newSlug.trim(),
        close_source: closeSource,
        frontmatter: {
          // Tier 1 — always carried
          partner: tier1.partner,
          hive_mind_partner_slug: tier1.hive_mind_partner_slug,
          kind: tier1.kind,
          nda: tier1.nda,
          tags: tier1.tags,
          production_url: tier1.production_url,
          slack_channel: tier1.slack_channel,
          zendesk_search_terms: tier1.zendesk_search_terms,
          // Tier 2 — carry only if checked
          github_repo: tier2Checked.github_repo ? tier2.github_repo : undefined,
          staging_url: tier2Checked.staging_url ? tier2.staging_url : undefined,
          figma_url: tier2Checked.figma_url ? tier2.figma_url : undefined,
          google_drive_url: tier2Checked.google_drive_url
            ? tier2.google_drive_url
            : undefined,
          p2_url: tier2Checked.p2_url ? tier2.p2_url : undefined,
          // New for this phase — user-typed
          linear_project_id: linearId.trim() || undefined,
          linear_project_slug: linearSlug.trim() || undefined,
        },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const parts = [`Created "${newName.trim()}"`];
      if (result.source_closed) parts.push(`archived ${project.name}`);
      toast.success(parts.join(" · "));
      setOpen(false);
      router.push(`/projects/${result.new_slug}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Copy className="size-3.5" />
          Clone as new project
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Clone {project.name} as new project</DialogTitle>
          <DialogDescription>
            Seeds a sibling project with partner identity + selected
            reference URLs. Instance-specific fields (Zendesk tickets,
            call notes, follow-ups, Open Items) always start fresh.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {/* New project name + slug */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-foreground font-medium">New name</span>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => onNameChange(e.target.value)}
                    disabled={saving}
                    placeholder={`${project.name} — Phase 3`}
                    className={inputClass}
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-foreground font-medium">New slug</span>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    disabled={saving}
                    placeholder="the-pocket-nyc-phase-3"
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-foreground font-medium">
                  Paste the new Linear project URL (optional)
                </span>
                <input
                  type="text"
                  onChange={(e) => {
                    const parsed = parseLinearProjectUrl(e.target.value);
                    if (!parsed) return;
                    if (parsed.id) setLinearId(parsed.id);
                    setLinearSlug(parsed.slug);
                  }}
                  disabled={saving}
                  placeholder="https://linear.app/team51/project/pocket-nyc-phase-3-abc123"
                  className={inputClass}
                />
                <span className="text-muted-foreground text-[11px]">
                  ID and slug fill in below automatically.
                </span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-foreground font-medium">
                    Linear project ID
                  </span>
                  <input
                    type="text"
                    value={linearId}
                    onChange={(e) => setLinearId(e.target.value)}
                    disabled={saving}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-foreground font-medium">
                    Linear slug
                  </span>
                  <input
                    type="text"
                    value={linearSlug}
                    onChange={(e) => setLinearSlug(e.target.value)}
                    disabled={saving}
                    className={inputClass}
                  />
                </label>
              </div>
            </div>

            {/* Tier 1 — auto-copied */}
            <div className="space-y-1.5">
              <p className="text-foreground text-xs font-medium">
                Partner identity — always copied
              </p>
              <ul className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {[
                  ["partner", tier1.partner],
                  ["hive_mind_partner_slug", tier1.hive_mind_partner_slug],
                  ["kind", tier1.kind],
                  ["nda", tier1.nda ? "true" : undefined],
                  ["tags", tier1.tags?.join(", ")],
                  ["production_url", tier1.production_url],
                  ["slack_channel", tier1.slack_channel],
                  [
                    "zendesk_search_terms",
                    tier1.zendesk_search_terms?.join(", "),
                  ],
                ]
                  .filter(([, v]) => Boolean(v))
                  .map(([k, v]) => (
                    <li key={k as string} className="truncate">
                      <code className="text-foreground font-mono">{k}</code>{" "}
                      <span className="text-muted-foreground">{v}</span>
                    </li>
                  ))}
              </ul>
            </div>

            {/* Tier 2 — user-optional carry */}
            <div className="space-y-1.5">
              <p className="text-foreground text-xs font-medium">
                Usually the same — uncheck to leave blank
              </p>
              <div className="space-y-1">
                {(
                  [
                    ["github_repo", "GitHub repo", tier2.github_repo],
                    ["staging_url", "Staging URL", tier2.staging_url],
                    ["figma_url", "Figma", tier2.figma_url],
                    [
                      "google_drive_url",
                      "Google Drive",
                      tier2.google_drive_url,
                    ],
                    ["p2_url", "P2 URL", tier2.p2_url],
                  ] as const
                ).map(([key, label, value]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={tier2Checked[key]}
                      disabled={!value || saving}
                      onChange={(e) =>
                        setTier2Checked((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="accent-foreground"
                    />
                    <span className="text-foreground font-medium">
                      {label}
                    </span>
                    <span className="text-muted-foreground truncate">
                      {value ?? "(not set on source)"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Tier 3 — info */}
            <div className="space-y-1">
              <p className="text-foreground text-xs font-medium">
                Always fresh — not carried
              </p>
              <p className="text-muted-foreground text-[11px]">
                Zendesk tickets, call notes, follow-ups, personal notes,
                Open Items, project ID, agenda file, Fathom search terms
                — all belong to the source phase and won't follow.
              </p>
            </div>

            {/* Close source */}
            <label className="flex items-center gap-2 border-t pt-3 text-sm">
              <input
                type="checkbox"
                checked={closeSource}
                onChange={(e) => setCloseSource(e.target.checked)}
                className="accent-foreground"
              />
              <span>
                Archive <strong>{project.name}</strong> (sets status =
                archived; you can restore later via metadata edit)
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            size="sm"
            className={cn("gap-1.5")}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Copy className="size-3.5" />
            )}
            Create + open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
