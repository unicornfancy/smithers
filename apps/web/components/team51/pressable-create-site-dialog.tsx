"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Server } from "lucide-react";
import { toast } from "sonner";

import { startPressableCreateSiteAction } from "@/app/projects/[slug]/team51/actions";
import { cleanPressableName } from "@/lib/team51-names";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  suggestedName: string;
  defaultRepository: string;
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

/**
 * pressable:create-site form. Fields mirror the CLI (see
 * Pressable_Site_Create.php configure()):
 *   name (arg)                — slugified, dashes preserved
 *   --datacenter              — Pressable DC code (default DFW)
 *   --repository              — GitHub repo for deployments
 *   --project-template        — project | no-code-project
 *   --no-code-theme           — only for no-code-project
 *
 * Datacenter is a free-text input because the actual list comes
 * from the Pressable API at runtime — hardcoding it would drift
 * silently. Placeholder hints the common codes.
 */
export function PressableCreateSiteDialog({
  open,
  onOpenChange,
  projectSlug,
  suggestedName,
  defaultRepository,
}: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(suggestedName);
  const [datacenter, setDatacenter] = React.useState("");
  const [repository, setRepository] = React.useState(defaultRepository);
  const [template, setTemplate] = React.useState<"project" | "no-code-project">(
    "project",
  );
  const [noCodeTheme, setNoCodeTheme] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setName(suggestedName);
      setDatacenter("");
      setRepository(defaultRepository);
      setTemplate("project");
      setNoCodeTheme("");
    }
  }, [open, suggestedName, defaultRepository]);

  const cleaned = cleanPressableName(name);
  const nameOk = cleaned.length >= 3;

  function submit() {
    if (!nameOk) {
      toast.error("Site name needs at least 3 letters or digits after cleanup.");
      return;
    }
    if (template === "no-code-project" && !noCodeTheme.trim()) {
      toast.error("Pick a no-code theme when using the no-code-project template.");
      return;
    }
    startTransition(async () => {
      const res = await startPressableCreateSiteAction({
        project_slug: projectSlug,
        name: cleaned,
        datacenter: datacenter.trim() || undefined,
        repository: repository.trim() || undefined,
        project_template: template,
        no_code_theme:
          template === "no-code-project" ? noCodeTheme.trim() : undefined,
      });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      toast.success("Started — following the run…");
      onOpenChange(false);
      router.push(`/projects/${projectSlug}/team51/${res.data.run_id}`);
    });
  }

  const summary = React.useMemo(() => {
    const dc = datacenter.trim() || "DFW";
    const repoBit = repository.trim()
      ? `connected to \`${repository.trim()}\` via WPCOM Deployments (${template})`
      : "without connecting a GitHub repo";
    return `Creating Pressable site \`${cleaned || "?"}\` in ${dc} ${repoBit}.`;
  }, [cleaned, datacenter, repository, template]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-4" />
            Create Pressable site
          </DialogTitle>
          <DialogDescription>
            Runs{" "}
            <code className="font-mono">team51 pressable:create-site</code>{" "}
            with everything pre-filled.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pcs-name" className="text-sm font-medium">
              Site name
            </label>
            <input
              id="pcs-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              disabled={pending}
            />
            <p className="text-muted-foreground text-[11px]">
              Preview: <code className="font-mono">{cleaned || "(empty)"}</code>{" "}
              (dashes kept, unlike WordPress.com).
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pcs-dc" className="text-sm font-medium">
              Datacenter{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <input
              id="pcs-dc"
              type="text"
              value={datacenter}
              onChange={(e) => setDatacenter(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="DFW · IAD · PHX · AMS · SIN"
              disabled={pending}
              maxLength={4}
            />
            <p className="text-muted-foreground text-[11px]">
              Pressable DC code. Leave blank for DFW (Dallas). Live list
              lives at the Pressable API — Smithers doesn&apos;t hardcode.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pcs-repo" className="text-sm font-medium">
              GitHub repo{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <input
              id="pcs-repo"
              type="text"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              className={inputClass}
              placeholder="a8cteam51/<repo-name>"
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Project template</label>
            <div className="flex gap-2">
              {(["project", "no-code-project"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTemplate(t)}
                  disabled={pending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                    template === t
                      ? "border-emerald-500/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "bg-background hover:bg-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {template === "no-code-project" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pcs-theme" className="text-sm font-medium">
                No-code theme
              </label>
              <input
                id="pcs-theme"
                type="text"
                value={noCodeTheme}
                onChange={(e) => setNoCodeTheme(e.target.value)}
                className={inputClass}
                disabled={pending}
              />
            </div>
          ) : null}

          <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
            <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="space-y-1">
              <p className="font-medium">This is the confirmation step.</p>
              <p className="text-muted-foreground">{summary}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !nameOk}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
