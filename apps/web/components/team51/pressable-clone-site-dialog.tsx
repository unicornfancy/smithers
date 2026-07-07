"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { startPressableCloneSiteAction } from "@/app/projects/[slug]/team51/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  /** Default source site URL — pulled from the project's production_url. */
  defaultSourceSite: string;
}

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

/**
 * pressable:clone-site — Katie's launch-day workflow. Clones an
 * existing Pressable site into a development sibling. See
 * Pressable_Site_Clone.php:
 *   site (arg, required)      — source domain or Pressable ID
 *   label (arg, optional)     — suffix; defaults to "development"
 *   --datacenter              — DC code
 *   --branch                  — Git branch to deploy after clone
 *   --skip-safety-net         — omit SafetyNet mu-plugin
 */
export function PressableCloneSiteDialog({
  open,
  onOpenChange,
  projectSlug,
  defaultSourceSite,
}: Props) {
  const router = useRouter();
  const [sourceSite, setSourceSite] = React.useState(defaultSourceSite);
  const [label, setLabel] = React.useState("");
  const [datacenter, setDatacenter] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [skipSafetyNet, setSkipSafetyNet] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setSourceSite(defaultSourceSite);
      setLabel("");
      setDatacenter("");
      setBranch("");
      setSkipSafetyNet(false);
    }
  }, [open, defaultSourceSite]);

  const sourceOk = sourceSite.trim().length > 0;

  function submit() {
    if (!sourceOk) {
      toast.error("Pick a source site (domain or Pressable ID).");
      return;
    }
    startTransition(async () => {
      const res = await startPressableCloneSiteAction({
        project_slug: projectSlug,
        source_site: sourceSite,
        label: label.trim() || undefined,
        datacenter: datacenter.trim() || undefined,
        branch: branch.trim() || undefined,
        skip_safety_net: skipSafetyNet,
      });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      toast.success("Cloning — following the run…");
      onOpenChange(false);
      router.push(`/projects/${projectSlug}/team51/${res.data.run_id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-4" />
            Clone Pressable site
          </DialogTitle>
          <DialogDescription>
            Runs{" "}
            <code className="font-mono">team51 pressable:clone-site</code> —
            the launch-day flow.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pclone-source" className="text-sm font-medium">
              Source site
            </label>
            <input
              id="pclone-source"
              type="text"
              value={sourceSite}
              onChange={(e) => setSourceSite(e.target.value)}
              className={inputClass}
              placeholder="site.com or numeric Pressable ID"
              disabled={pending}
            />
            <p className="text-muted-foreground text-[11px]">
              Pre-filled from the project&apos;s{" "}
              <code className="font-mono">production_url</code> when set.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pclone-label" className="text-sm font-medium">
              Label{" "}
              <span className="text-muted-foreground font-normal">
                (optional — default &ldquo;development&rdquo;)
              </span>
            </label>
            <input
              id="pclone-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
              placeholder="development"
              disabled={pending}
            />
            <p className="text-muted-foreground text-[11px]">
              Suffix appended to the cloned site name — e.g. clone of{" "}
              <code className="font-mono">site.com</code> becomes{" "}
              <code className="font-mono">site-{label || "development"}.com</code>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pclone-dc" className="text-sm font-medium">
                Datacenter
              </label>
              <input
                id="pclone-dc"
                type="text"
                value={datacenter}
                onChange={(e) => setDatacenter(e.target.value.toUpperCase())}
                className={inputClass}
                placeholder="Match source"
                maxLength={4}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pclone-branch" className="text-sm font-medium">
                Deploy branch
              </label>
              <input
                id="pclone-branch"
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className={inputClass}
                placeholder="develop"
                disabled={pending}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={skipSafetyNet}
              onChange={(e) => setSkipSafetyNet(e.target.checked)}
              disabled={pending}
              className="h-4 w-4"
            />
            <span>Skip SafetyNet mu-plugin</span>
          </label>

          <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
            <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="space-y-1">
              <p className="font-medium">Confirmation step.</p>
              <p className="text-muted-foreground">
                Cloning{" "}
                <code className="font-mono">{sourceSite || "?"}</code> as{" "}
                <code className="font-mono">
                  {sourceSite || "?"}-{label || "development"}
                </code>
                . The clone starts a fresh WP admin password stored in
                1Password.
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
            disabled={pending || !sourceOk}
            className="gap-1.5"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Clone site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
