"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { startWpcomCreateSiteAction } from "@/app/projects/[slug]/team51/actions";
import { cleanWpcomName } from "@/lib/team51-names";
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
 * Form for `wpcom:create-site`. Fields mirror the CLI's declared
 * args/options (see WPCOM_Site_Create.php configure()):
 *   - name (required arg)      — slugified, no dashes
 *   - repository (option)      — GitHub repo to deploy from
 *   - project-template (opt)   — project / no-code-project
 *   - no-code-theme (opt)      — only when project-template === no-code-project
 *
 * Symfony's confirmation prompt ("Are you sure…?") is replaced by
 * a Smithers-native two-step: fill the form → dialog footer shows a
 * summary sentence + Confirm button. That way `--no-interaction`
 * doesn't short-circuit the CLI's confirm-to-false and we still
 * gate the destructive create step on an explicit click.
 */
export function WpcomCreateSiteDialog({
  open,
  onOpenChange,
  projectSlug,
  suggestedName,
  defaultRepository,
}: Props) {
  const router = useRouter();
  const [name, setName] = React.useState(suggestedName);
  const [repository, setRepository] = React.useState(defaultRepository);
  const [template, setTemplate] = React.useState<"project" | "no-code-project">(
    "project",
  );
  const [noCodeTheme, setNoCodeTheme] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setName(suggestedName);
      setRepository(defaultRepository);
      setTemplate("project");
      setNoCodeTheme("");
    }
  }, [open, suggestedName, defaultRepository]);

  const cleaned = cleanWpcomName(name);
  const nameLooksValid = cleaned.length >= 3;

  function submit() {
    if (!nameLooksValid) {
      toast.error("Site name needs at least 3 letters or digits after cleanup.");
      return;
    }
    if (template === "no-code-project" && !noCodeTheme.trim()) {
      toast.error("Pick a no-code theme when using the no-code-project template.");
      return;
    }
    startTransition(async () => {
      const res = await startWpcomCreateSiteAction({
        project_slug: projectSlug,
        name: cleaned,
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
    const repoBit = repository.trim()
      ? `connected to \`${repository.trim()}\` via WPCOM Deployments (${template})`
      : "without connecting a GitHub repo";
    return `Creating WordPress.com site \`${cleaned || "?"}\` ${repoBit}.`;
  }, [cleaned, repository, template]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Create WordPress.com site
          </DialogTitle>
          <DialogDescription>
            Runs{" "}
            <code className="font-mono">team51 wpcom:create-site</code> with
            everything pre-filled — no CLI prompts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wcs-name" className="text-sm font-medium">
              Site name
            </label>
            <input
              id="wcs-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g. neighborhoodnip"
              disabled={pending}
            />
            <p className="text-muted-foreground text-[11px]">
              WordPress.com strips dashes and lowercases. Preview:{" "}
              <code className="font-mono">{cleaned || "(empty)"}</code>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wcs-repo" className="text-sm font-medium">
              GitHub repo{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <input
              id="wcs-repo"
              type="text"
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              className={inputClass}
              placeholder="a8cteam51/<repo-name>"
              disabled={pending}
            />
            <p className="text-muted-foreground text-[11px]">
              Team51 repo the site deploys from. Leave blank to skip the
              Deployments hookup.
            </p>
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
              <label htmlFor="wcs-theme" className="text-sm font-medium">
                No-code theme
              </label>
              <input
                id="wcs-theme"
                type="text"
                value={noCodeTheme}
                onChange={(e) => setNoCodeTheme(e.target.value)}
                className={inputClass}
                placeholder="Theme slug"
                disabled={pending}
              />
            </div>
          ) : null}

          <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
            <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="space-y-1">
              <p className="font-medium">This is the confirmation step.</p>
              <p className="text-muted-foreground">{summary}</p>
              <p className="text-muted-foreground">
                Once you click Create, the CLI runs against the real
                Automattic APIs — pausing mid-flow won&apos;t un-do the
                partial state.
              </p>
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
            disabled={pending || !nameLooksValid}
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
