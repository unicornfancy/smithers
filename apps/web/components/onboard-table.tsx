"use client";

import type { HiveMindPartnerSummary } from "@smithers/mcp-client";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  connectProjectToHiveMindAction,
  importFromHiveMindAction,
  importFromHiveMindBatchAction,
  repairKindForHiveMindImportsAction,
  setupProjectFromLinearAction,
} from "@/app/projects/onboard/actions";
import type { OnboardRow } from "@/app/projects/onboard/page";
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
  rows: OnboardRow[];
  showAll: boolean;
  hmPartners: HiveMindPartnerSummary[];
}

// Local slugifier — kept inline to avoid pulling @smithers/vault's barrel
// (and its node:crypto-using id helpers) into the client bundle.
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const GENERIC_SLUG_TOKENS = new Set([
  "phase",
  "redesign",
  "migration",
  "rebuild",
  "launch",
  "site",
  "new",
  "old",
  "project",
  "v1",
  "v2",
  "v3",
]);

// Mirror of @smithers/vault/slug.isGenericSlug — duplicated so this client
// component doesn't pull the vault barrel. Keep in sync.
function isGenericSlug(slug: string): boolean {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.length < 6) return true;
  const tokens = trimmed.split("-").filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1) return GENERIC_SLUG_TOKENS.has(tokens[0]!);
  return tokens.every(
    (t) => GENERIC_SLUG_TOKENS.has(t) || /^\d{1,2}$/.test(t),
  );
}

export function OnboardTable({ rows, showAll, hmPartners }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Default = all importable rows checked.
    const s = new Set<string>();
    for (const r of rows) if (r.action === "import") s.add(r.rowKey);
    return s;
  });
  const [connectRow, setConnectRow] = useState<OnboardRow | null>(null);
  const [setupRow, setSetupRow] = useState<OnboardRow | null>(null);

  const importableKeys = useMemo(
    () => rows.filter((r) => r.action === "import").map((r) => r.rowKey),
    [rows],
  );

  function toggleAll(check: boolean) {
    if (check) {
      setSelected(new Set(importableKeys));
    } else {
      setSelected(new Set());
    }
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function importSelected() {
    const refs = rows
      .filter((r) => r.action === "import" && r.hm && selected.has(r.rowKey))
      .map((r) => ({
        partnerSlug: r.hm!.partnerSlug,
        projectSlug: r.hm!.projectSlug,
        title: r.hm!.title,
        // r.linear is backfilled in buildRows when an HM project name matches
        // a Linear project. Storing the slugId matches existing vault frontmatter.
        linearProjectId: r.linear?.slugId,
      }));
    if (refs.length === 0 || pending) return;
    startTransition(async () => {
      try {
        const result = await importFromHiveMindBatchAction(refs);
        const ok = result.results.filter((r) => r.ok).length;
        const failed = result.results.length - ok;
        toast.success(`Imported ${ok}${failed ? ` · ${failed} failed` : ""}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      }
    });
  }

  function importSingle(row: OnboardRow) {
    if (!row.hm || pending) return;
    startTransition(async () => {
      try {
        const result = await importFromHiveMindAction({
          partnerSlug: row.hm!.partnerSlug,
          projectSlug: row.hm!.projectSlug,
          title: row.hm!.title,
          linearProjectId: row.linear?.slugId,
        });
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
        toast.success(result.created ? "Imported" : "Already exists");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      }
    });
  }

  function toggleShowAll() {
    const params = new URLSearchParams(searchParams);
    if (showAll) params.delete("all");
    else params.set("all", "1");
    router.push(`/projects/onboard${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function repair() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await repairKindForHiveMindImportsAction();
        if (result.fixed === 0) {
          toast.success("All HM-linked scratchpads already correct");
        } else {
          toast.success(`Repaired ${result.fixed} scratchpad${result.fixed === 1 ? "" : "s"}`);
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Repair failed");
      }
    });
  }

  const selectedCount = selected.size;
  const allChecked =
    importableKeys.length > 0 && selected.size === importableKeys.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted-foreground text-sm">
          Linear filter: <span className="font-medium">{showAll ? "all states" : "Started + Backlog"}</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={repair}
            disabled={pending}
            title="Set kind: partner on any HM-linked scratchpad missing it"
          >
            Repair
          </Button>
          <Button variant="outline" size="sm" onClick={toggleShowAll}>
            {showAll ? "Show Started + Backlog only" : "Show all states"}
          </Button>
        </div>
      </div>

      {importableKeys.length > 0 ? (
        <div className="bg-muted/40 border-muted-foreground/15 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => toggleAll(e.target.checked)}
              className="size-4"
            />
            <span>
              {selectedCount > 0
                ? `${selectedCount} selected`
                : `Select all ${importableKeys.length} importable`}
            </span>
          </label>
          <Button
            size="sm"
            onClick={importSelected}
            disabled={selectedCount === 0 || pending}
          >
            {pending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Import selected
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left font-medium">Project</th>
              <th className="px-3 py-2 text-left font-medium">Linear</th>
              <th className="px-3 py-2 text-left font-medium">Hive-Mind</th>
              <th className="px-3 py-2 text-left font-medium">Vault</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowKey} className="border-t">
                <td className="px-3 py-2">
                  {row.action === "import" ? (
                    <input
                      type="checkbox"
                      checked={selected.has(row.rowKey)}
                      onChange={() => toggleRow(row.rowKey)}
                      className="size-4"
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.displayName}</div>
                  {row.hm ? (
                    <div className="text-muted-foreground text-xs">
                      {row.hm.partnerSlug}/{row.hm.projectSlug}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {row.linear ? (
                    <Badge variant="secondary" className="font-normal">
                      {row.linear.state || "linked"}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.hm ? (
                    <Badge variant="secondary" className="font-normal">
                      linked
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.vaultSlug ? (
                    <Badge variant="secondary" className="font-normal">
                      linked
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.action === "open" && row.vaultSlug ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/projects/${row.vaultSlug}`}>
                        Open <ArrowRight className="ml-1 size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                  {row.action === "import" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => importSingle(row)}
                      disabled={pending}
                    >
                      Import
                    </Button>
                  ) : null}
                  {row.action === "connect" && row.vaultSlug ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConnectRow(row)}
                      disabled={pending}
                    >
                      Connect to HM
                    </Button>
                  ) : null}
                  {row.action === "setup" && row.linear ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSetupRow(row)}
                      disabled={pending}
                    >
                      Set up
                    </Button>
                  ) : null}
                  {row.action === "none" ? (
                    <span className="text-muted-foreground/60 text-xs">—</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConnectDialog
        row={connectRow}
        partners={hmPartners}
        onClose={() => setConnectRow(null)}
        onSuccess={() => {
          setConnectRow(null);
          router.refresh();
        }}
      />
      <SetupDialog
        row={setupRow}
        partners={hmPartners}
        onClose={() => setSetupRow(null)}
        onSuccess={() => {
          setSetupRow(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function SetupDialog({
  row,
  partners,
  onClose,
  onSuccess,
}: {
  row: OnboardRow | null;
  partners: HiveMindPartnerSummary[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [partnerSlug, setPartnerSlug] = useState("");
  const [partnerTitle, setPartnerTitle] = useState("");
  const [partnerDescription, setPartnerDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");

  // Re-sync defaults when row changes. Heuristic: take the Linear project
  // name, slugify, derive a candidate partner slug from the leading words
  // up to the first " - " separator (e.g. "Cathys Critters - WP redesign"
  // → partner "cathys-critters"; project "wp-redesign").
  useMemo(() => {
    if (!row?.linear) return;
    const linearName = row.linear.name;
    const split = linearName.split(/\s+[-–—:]\s+/);
    const partnerCandidate = split.length > 1 ? slugify(split[0]!) : "";
    const projectCandidate =
      split.length > 1 ? slugify(split.slice(1).join(" ")) : slugify(linearName);
    const matched = partnerCandidate
      ? partners.find((p) => p.slug === partnerCandidate)
      : undefined;
    setMode(matched ? "existing" : "new");
    setPartnerSlug(partnerCandidate);
    setPartnerTitle(split[0] ?? "");
    setPartnerDescription("");
    setProjectName(split.length > 1 ? split.slice(1).join(" ") : linearName);
    setProjectSlug(projectCandidate);
  }, [row, partners]);

  if (!row || !row.linear) return null;

  function submit() {
    if (!row?.linear) return;
    const ps = partnerSlug.trim();
    const proj = projectSlug.trim();
    const name = projectName.trim();
    if (!ps || !proj || !name) {
      toast.error("Project name, project slug, and partner slug required");
      return;
    }
    const isNew = mode === "new";
    if (isNew && (!partnerTitle.trim() || !partnerDescription.trim())) {
      toast.error("Partner title and description required for a new partner");
      return;
    }
    startTransition(async () => {
      try {
        const result = await setupProjectFromLinearAction({
          projectName: name,
          projectSlug: proj,
          linearProjectId: row.linear!.id,
          linearProjectSlug: row.linear!.slugId,
          partnerSlug: ps,
          partnerTitle: partnerTitle.trim(),
          partnerDescription: partnerDescription.trim(),
          partnerIsNew: isNew,
        });
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
        toast.success("Project set up");
        onSuccess();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Set up failed");
      }
    });
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">From Linear:</span>{" "}
            <span className="font-medium">{row.linear.name}</span>
          </div>

          <div>
            <label className="block text-xs">Project name</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs">Project slug</label>
            <input
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <p className="text-muted-foreground mt-1 text-[11px]">
              Use a partner-specific slug. Generic slugs like{" "}
              <code className="bg-muted rounded px-1">phase-2</code> or{" "}
              <code className="bg-muted rounded px-1">redesign</code> collide
              with other projects when matching follow-ups.
            </p>
            {isGenericSlug(projectSlug) && partnerSlug.trim() ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Too generic — the vault will be created as{" "}
                <code className="bg-muted rounded px-1">
                  {partnerSlug.trim()}-{projectSlug}
                </code>{" "}
                instead.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              Partner
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={mode === "existing" ? "default" : "outline"}
                onClick={() => setMode("existing")}
              >
                Existing
              </Button>
              <Button
                size="sm"
                variant={mode === "new" ? "default" : "outline"}
                onClick={() => setMode("new")}
              >
                Create new
              </Button>
            </div>
          </div>

          {mode === "existing" ? (
            <div>
              <label className="block text-xs">Partner slug</label>
              <select
                value={partnerSlug}
                onChange={(e) => setPartnerSlug(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— select —</option>
                {partners.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.title} ({p.slug})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-xs">Partner slug</label>
                <input
                  value={partnerSlug}
                  onChange={(e) => setPartnerSlug(e.target.value)}
                  placeholder="kebab-case"
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs">Partner title</label>
                <input
                  value={partnerTitle}
                  onChange={(e) => setPartnerTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs">Partner description</label>
                <input
                  value={partnerDescription}
                  onChange={(e) => setPartnerDescription(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Set up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectDialog({
  row,
  partners,
  onClose,
  onSuccess,
}: {
  row: OnboardRow | null;
  partners: HiveMindPartnerSummary[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const partnerOptions = useMemo(() => partners, [partners]);

  // Auto-pick existing partner if vaultPartner matches a known HM partner slug.
  const matchedPartner = row?.vaultPartner
    ? partners.find((p) => p.slug === row.vaultPartner)
    : undefined;

  const [mode, setMode] = useState<"existing" | "new">(
    matchedPartner ? "existing" : "new",
  );
  const [partnerSlug, setPartnerSlug] = useState(row?.vaultPartner ?? "");
  const [partnerTitle, setPartnerTitle] = useState("");
  const [partnerDescription, setPartnerDescription] = useState("");
  const [projectSlug, setProjectSlug] = useState(row?.vaultSlug ?? "");

  // Re-sync defaults when the row changes (open new dialog for new row).
  useMemo(() => {
    if (!row) return;
    const matched = row.vaultPartner
      ? partners.find((p) => p.slug === row.vaultPartner)
      : undefined;
    setMode(matched ? "existing" : "new");
    setPartnerSlug(row.vaultPartner ?? "");
    setPartnerTitle("");
    setPartnerDescription("");
    setProjectSlug(row.vaultSlug ?? "");
  }, [row, partners]);

  if (!row || !row.vaultSlug) return null;

  function submit() {
    if (!row || !row.vaultSlug) return;
    const ps = partnerSlug.trim();
    const proj = projectSlug.trim();
    if (!ps || !proj) {
      toast.error("Partner and project slugs are required");
      return;
    }
    const isNew = mode === "new";
    if (isNew && (!partnerTitle.trim() || !partnerDescription.trim())) {
      toast.error("Partner title and description are required for a new partner");
      return;
    }
    startTransition(async () => {
      try {
        const result = await connectProjectToHiveMindAction({
          vaultSlug: row.vaultSlug!,
          partnerSlug: ps,
          partnerTitle: partnerTitle.trim(),
          partnerDescription: partnerDescription.trim(),
          partnerIsNew: isNew,
          projectSlug: proj,
        });
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
        toast.success("Connected to Hive-Mind");
        onSuccess();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Connect failed");
      }
    });
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect to Hive-Mind</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Project:</span>{" "}
            <span className="font-medium">{row.displayName}</span>
          </div>

          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              Partner
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={mode === "existing" ? "default" : "outline"}
                onClick={() => setMode("existing")}
              >
                Existing
              </Button>
              <Button
                size="sm"
                variant={mode === "new" ? "default" : "outline"}
                onClick={() => setMode("new")}
              >
                Create new
              </Button>
            </div>
          </div>

          {mode === "existing" ? (
            <div>
              <label className="block text-xs">Partner slug</label>
              <select
                value={partnerSlug}
                onChange={(e) => setPartnerSlug(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— select —</option>
                {partnerOptions.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.title} ({p.slug})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-xs">Partner slug</label>
                <input
                  value={partnerSlug}
                  onChange={(e) => setPartnerSlug(e.target.value)}
                  placeholder="kebab-case"
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs">Partner title</label>
                <input
                  value={partnerTitle}
                  onChange={(e) => setPartnerTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs">Partner description</label>
                <input
                  value={partnerDescription}
                  onChange={(e) => setPartnerDescription(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs">Project slug</label>
            <input
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <p className="text-muted-foreground mt-1 text-[11px]">
              Use a partner-specific slug. Generic slugs like{" "}
              <code className="bg-muted rounded px-1">phase-2</code> or{" "}
              <code className="bg-muted rounded px-1">redesign</code> collide
              with other projects when matching follow-ups.
            </p>
            {isGenericSlug(projectSlug) && partnerSlug.trim() ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Too generic — the vault will be created as{" "}
                <code className="bg-muted rounded px-1">
                  {partnerSlug.trim()}-{projectSlug}
                </code>{" "}
                instead.
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
