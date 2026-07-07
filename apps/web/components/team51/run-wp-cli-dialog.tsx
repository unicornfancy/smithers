"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Terminal } from "lucide-react";
import { toast } from "sonner";

import { startRunWpCliCommandAction } from "@/app/projects/[slug]/team51/actions";
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
  /** Pre-filled site — pulled from staging/production URL frontmatter. */
  defaultSite: string;
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

const PRESETS = [
  { label: "wp --info", cmd: "--info" },
  { label: "wp option get siteurl", cmd: "option get siteurl" },
  { label: "wp cache flush", cmd: "cache flush" },
  { label: "wp plugin list", cmd: "plugin list" },
  { label: "wp user list", cmd: "user list --fields=ID,user_login,roles" },
];

/**
 * Runs `wpcom:run-site-wp-cli-command` or its Pressable sibling.
 * Small tripwire on `db reset` / `--allow-root` server-side; not a
 * safety net, just a nudge.
 */
export function RunWpCliDialog({
  open,
  onOpenChange,
  projectSlug,
  defaultSite,
}: Props) {
  const router = useRouter();
  const [platform, setPlatform] = React.useState<"wpcom" | "pressable">(
    "pressable",
  );
  const [site, setSite] = React.useState(defaultSite);
  const [command, setCommand] = React.useState("");
  const [skipOutput, setSkipOutput] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setPlatform("pressable");
      setSite(defaultSite);
      setCommand("");
      setSkipOutput(false);
    }
  }, [open, defaultSite]);

  const ok = site.trim().length > 0 && command.trim().length > 0;

  function submit() {
    if (!ok) {
      toast.error("Site + WP-CLI command are both required.");
      return;
    }
    startTransition(async () => {
      const res = await startRunWpCliCommandAction({
        project_slug: projectSlug,
        platform,
        site: site.trim(),
        wp_cli_command: command.trim(),
        skip_output: skipOutput,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            Run WP-CLI on a site
          </DialogTitle>
          <DialogDescription>
            Runs{" "}
            <code className="font-mono">
              team51 {platform}:run-site-wp-cli-command
            </code>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Platform</label>
            <div className="flex gap-2">
              {(["pressable", "wpcom"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  disabled={pending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                    platform === p
                      ? "border-emerald-500/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "bg-background hover:bg-muted",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rwc-site" className="text-sm font-medium">
              Site
            </label>
            <input
              id="rwc-site"
              type="text"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className={inputClass}
              placeholder="domain or numeric ID"
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rwc-cmd" className="text-sm font-medium">
              WP-CLI command
            </label>
            <input
              id="rwc-cmd"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={cn(inputClass, "font-mono")}
              placeholder="option get siteurl"
              disabled={pending}
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setCommand(p.cmd)}
                  disabled={pending}
                  className="text-muted-foreground hover:text-foreground rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-[11px]">
              Enter the command WITHOUT the leading{" "}
              <code className="font-mono">wp</code>. Destructive commands
              like{" "}
              <code className="font-mono">db reset</code> are refused —
              run those in your terminal.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={skipOutput}
              onChange={(e) => setSkipOutput(e.target.checked)}
              disabled={pending}
              className="h-4 w-4"
            />
            <span>Skip printing WP-CLI output (fire-and-forget)</span>
          </label>

          <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
            <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="space-y-1">
              <p className="font-medium">Confirmation.</p>
              <p className="text-muted-foreground">
                Running{" "}
                <code className="font-mono">wp {command || "?"}</code> against{" "}
                <code className="font-mono">{site || "?"}</code> on {platform}.
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
            disabled={pending || !ok}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
