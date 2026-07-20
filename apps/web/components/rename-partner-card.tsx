"use client";

import * as React from "react";
import { Loader2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  listKnownPartnerSlugsAction,
  renamePartnerSlugAction,
} from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-8 rounded-md border px-2 text-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

/**
 * Settings → Diagnostics card for renaming a partner slug across the
 * vault + Hive Mind directory in one shot. Rewrites every project's
 * `hive_mind_partner_slug` / `partner:` field, `git mv`s the HM
 * directory, and commits only the renamed paths so other pending HM
 * edits stay unstaged. Idempotent — safe to re-run after a failure.
 */
export function RenamePartnerCard() {
  const router = useRouter();
  const [oldSlug, setOldSlug] = React.useState("");
  const [newSlug, setNewSlug] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [known, setKnown] = React.useState<string[]>([]);

  React.useEffect(() => {
    void listKnownPartnerSlugsAction()
      .then((r) => setKnown(r.slugs))
      .catch(() => setKnown([]));
  }, []);

  const disabled =
    pending || !oldSlug.trim() || !newSlug.trim() || oldSlug === newSlug;

  async function handleRename() {
    const from = oldSlug.trim().toLowerCase();
    const to = newSlug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(from) || !/^[a-z0-9][a-z0-9-]*$/.test(to)) {
      toast.error("Slugs must be kebab-case: lowercase letters, digits, hyphens.");
      return;
    }
    const confirmed = window.confirm(
      `Rename partner slug "${from}" → "${to}"?\n\n` +
        "This will:\n" +
        `  - rewrite every project frontmatter that references "${from}"\n` +
        "  - rename the Hive Mind partner directory\n" +
        "  - commit the HM rename (only those paths)\n\n" +
        "Safe to re-run if something goes wrong mid-flight.",
    );
    if (!confirmed) return;
    setPending(true);
    try {
      const result = await renamePartnerSlugAction({
        oldSlug: from,
        newSlug: to,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const { data } = result;
      if (!data.changed) {
        toast.success(`Nothing to change — "${to}" already looks correct.`);
      } else {
        const parts: string[] = [];
        parts.push(
          `${data.projects_updated.length} project${data.projects_updated.length === 1 ? "" : "s"} updated`,
        );
        if (data.dir_renamed) parts.push("HM dir renamed");
        if (data.committed) parts.push("commit made");
        toast.success(`Renamed ${from} → ${to}: ${parts.join(", ")}.`);
        if (data.projects_skipped.length > 0) {
          toast.message(
            `Skipped ${data.projects_skipped.length}: ${data.projects_skipped
              .map((s) => `${s.name} (${s.reason})`)
              .slice(0, 3)
              .join("; ")}`,
          );
        }
      }
      setOldSlug("");
      setNewSlug("");
      const refreshed = await listKnownPartnerSlugsAction().catch(() => ({
        slugs: [] as string[],
      }));
      setKnown(refreshed.slugs);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="size-4" /> Rename partner slug
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          One-shot rename: rewrites every project frontmatter that
          references the old slug (
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            hive_mind_partner_slug
          </code>{" "}
          and slug-shaped{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            partner
          </code>
          ), renames the Hive Mind{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            knowledge/partners/&lt;slug&gt;/
          </code>{" "}
          directory via{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
            git mv
          </code>
          , and commits only the renamed paths. Idempotent.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground font-medium">Current slug</span>
            <input
              type="text"
              value={oldSlug}
              onChange={(e) => setOldSlug(e.target.value)}
              placeholder="the-pocket-nyc"
              list="known-partner-slugs"
              disabled={pending}
              className={cn(inputClass)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground font-medium">New slug</span>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="the-pocket"
              disabled={pending}
              className={cn(inputClass)}
            />
          </label>
        </div>
        <datalist id="known-partner-slugs">
          {known.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <p className="text-muted-foreground text-[11px]">
          Known slugs: {known.length > 0 ? known.length : "none detected"}.
          Projects with{" "}
          <code className="bg-muted rounded px-1 py-0.5">kind: hive-mind</code>{" "}
          are read-only and will be listed as skipped.
        </p>
        <div className="flex items-center justify-end gap-3 border-t pt-3">
          <Button
            onClick={handleRename}
            disabled={disabled}
            size="sm"
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wand2 className="size-3.5" />
            )}
            Rename
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
