"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings } from "lucide-react";
import { toast } from "sonner";

import { setZendeskSearchTermsAction } from "@/app/projects/[slug]/actions";
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
  projectSlug: string;
  /** Currently-persisted search terms (one per line). */
  initialTerms: string[];
}

/**
 * Settings dialog for the Zendesk Threads panel. Lets the user curate
 * a list of free-form search terms (emails, partner contact names,
 * alternate aliases) that the Refresh flow will fan out alongside the
 * auto-detected hints. Saves to project frontmatter so it persists.
 */
export function ZendeskSearchSettingsModal({
  projectSlug,
  initialTerms,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => initialTerms.join("\n"));
  const [pending, startTransition] = React.useTransition();

  // Reset the textarea contents whenever the modal opens or the
  // initialTerms prop shifts (after a save + revalidate cycle).
  React.useEffect(() => {
    if (open) setText(initialTerms.join("\n"));
  }, [open, initialTerms]);

  function handleSave() {
    const terms = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      try {
        const r = await setZendeskSearchTermsAction(projectSlug, terms);
        if (r.changed) {
          toast.success(
            r.terms.length === 0
              ? "Cleared search terms"
              : `Saved ${r.terms.length} search term${r.terms.length === 1 ? "" : "s"}`,
          );
        } else {
          toast.info("No change to save");
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save search terms",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Search settings"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-3.5" />
          <span className="sr-only">Search settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zendesk search settings</DialogTitle>
          <DialogDescription>
            Free-form terms used by the Refresh flow to find this
            project&rsquo;s tickets. Partner contact emails and names work
            best — they tend to surface tickets the partner-name search
            misses (older threads, escalations, etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label
            htmlFor="zendesk-search-terms-input"
            className="text-foreground text-sm font-medium"
          >
            Search terms (one per line)
          </label>
          <textarea
            id="zendesk-search-terms-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"martin@thepocketnyc.com\nMartin Porter"}
            disabled={pending}
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "w-full resize-y rounded-md border px-3 py-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-1",
              "disabled:opacity-60",
              "font-mono",
            )}
          />
          <p className="text-muted-foreground text-[11px]">
            Saved to{" "}
            <code className="bg-muted rounded px-1 py-0.5">
              zendesk_search_terms
            </code>{" "}
            in the project&rsquo;s frontmatter. Empty clears it.
          </p>
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
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
