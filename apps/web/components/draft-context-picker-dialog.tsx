"use client";

import { ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type { ContextItem } from "@smithers/mcp-client";

import { resolveContextUrlAction } from "@/app/drafts/actions";
import {
  listPinnedContextAction,
  pinContextAction,
} from "@/app/projects/[slug]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PinnedRow {
  type: ContextItem["type"];
  ref: string;
  label: string;
  added: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title shown at the top of the dialog (e.g. "Draft reply for #12345"). */
  title: string;
  /** Project the context is being pinned/picked against. */
  projectSlug: string;
  /**
   * Optional read-only context block shown at the top of the picker —
   * e.g. the latest partner message on the Zendesk ticket the user is
   * about to reply to. Surfaces information they need to choose extra
   * context without forcing them to leave the dialog.
   */
  preview?: { label: string; body: string; meta?: string } | null;
  /**
   * Called when the user confirms — receives the curated list of context
   * items (with bodies) that should be passed to the agent. Empty list
   * is a valid choice (means "no extra context").
   */
  onGenerate: (items: ContextItem[]) => void;
  /** Disable the Generate button externally (e.g. while the agent runs). */
  busy?: boolean;
}

/**
 * Phase H draft context picker. Shown BEFORE the agent runs so the user
 * can review pinned items + attach extras + skip the suggestion engine
 * (H5, not yet built). Generate button is disabled until the user has
 * either attached/opted-in to ≥1 item or explicitly chosen "no extra
 * context" via the No Context checkbox — prevents silent agent runs
 * with stale defaults.
 */
export function DraftContextPickerDialog({
  open,
  onOpenChange,
  title,
  projectSlug,
  preview,
  onGenerate,
  busy,
}: Props) {
  const [pinned, setPinned] = React.useState<PinnedRow[]>([]);
  const [pinnedLoading, setPinnedLoading] = React.useState(false);
  // refs keyed by `pinned-<ref>` or `attached-<ref>` so we can dedupe.
  const [pinnedSelected, setPinnedSelected] = React.useState<Set<string>>(
    new Set(),
  );
  const [attached, setAttached] = React.useState<ContextItem[]>([]);
  const [urlInput, setUrlInput] = React.useState("");
  const [resolving, setResolving] = React.useState(false);
  const [pinThis, setPinThis] = React.useState(false);
  const [acknowledgedNoContext, setAcknowledgedNoContext] = React.useState(false);

  const reviewed =
    pinnedSelected.size > 0 || attached.length > 0 || acknowledgedNoContext;

  // Reset + load pinned items each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setUrlInput("");
    setPinThis(false);
    setAcknowledgedNoContext(false);
    setAttached([]);
    setPinnedLoading(true);
    void listPinnedContextAction(projectSlug)
      .then((res) => {
        setPinned(res.rows);
        // Default: pre-select all pins; user can opt-out.
        setPinnedSelected(new Set(res.rows.map((r) => r.ref)));
      })
      .catch(() => {
        setPinned([]);
        setPinnedSelected(new Set());
      })
      .finally(() => setPinnedLoading(false));
  }, [open, projectSlug]);

  function togglePinned(ref: string) {
    setPinnedSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function removeAttached(ref: string) {
    setAttached((prev) => prev.filter((item) => item.ref !== ref));
  }

  async function attachUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed || resolving) return;
    if (attached.some((it) => it.ref === trimmed)) {
      toast.error("Already attached");
      return;
    }
    if (pinned.some((p) => p.ref === trimmed)) {
      toast.error("Already pinned to this project");
      return;
    }
    setResolving(true);
    try {
      const res = await resolveContextUrlAction(trimmed);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      setAttached((prev) => [...prev, res.item]);
      // Optional: also pin permanently.
      if (pinThis) {
        const pinResult = await pinContextAction(projectSlug, {
          type: res.item.type,
          ref: res.item.ref,
          label: res.item.label,
        });
        if (pinResult.ok) {
          toast.success("Attached + pinned to project");
          setPinned((prev) => [
            ...prev,
            {
              type: res.item.type,
              ref: res.item.ref,
              label: res.item.label,
              added: new Date().toISOString().slice(0, 10),
            },
          ]);
          setPinnedSelected((prev) => new Set(prev).add(res.item.ref));
          // Drop from attached since it's now in the pinned list.
          setAttached((prev) => prev.filter((it) => it.ref !== res.item.ref));
        } else {
          toast.error(`Attached, but pinning failed: ${pinResult.reason}`);
        }
      } else {
        toast.success("Attached");
      }
      setUrlInput("");
      setPinThis(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setResolving(false);
    }
  }

  async function generate() {
    // Build the curated context list — selected pins + all manual attachments.
    // For pinned items, we have type/ref/label but NO body (intentionally
    // not persisted). Re-resolve them now so the agent sees fresh content.
    const curated: ContextItem[] = [...attached];
    const selectedPins = pinned.filter((p) => pinnedSelected.has(p.ref));
    for (const pin of selectedPins) {
      // Skip refresh when the URL doesn't look fetchable (e.g. call-transcript
      // local paths) — fall back to label-as-body so the agent at least sees
      // the title.
      const isUrl = /^https?:\/\//i.test(pin.ref);
      if (!isUrl) {
        curated.push({ type: pin.type, ref: pin.ref, label: pin.label, body: pin.label });
        continue;
      }
      const res = await resolveContextUrlAction(pin.ref).catch(() => null);
      if (res?.ok) {
        curated.push(res.item);
      } else {
        // Resolve failed; surface metadata only so the agent isn't fully blind.
        curated.push({ type: pin.type, ref: pin.ref, label: pin.label, body: pin.label });
      }
    }
    onGenerate(curated);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            Pick the extra context to include with this draft. Smithers
            won&apos;t generate anything until you&apos;ve reviewed.
          </p>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {preview ? (
            <section className="space-y-1.5">
              <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                {preview.label}
                {preview.meta ? (
                  <span className="text-muted-foreground/70 ml-2 normal-case">
                    {preview.meta}
                  </span>
                ) : null}
              </h3>
              <div className="bg-muted/40 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-xs leading-relaxed">
                {preview.body}
              </div>
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Pinned to this project
            </h3>
            {pinnedLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Loading pins…
              </div>
            ) : pinned.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No pinned context yet. Pin items via the Attach field below
                with the &quot;Pin permanently&quot; checkbox.
              </p>
            ) : (
              <ul className="divide-border divide-y overflow-hidden rounded-md border">
                {pinned.map((row) => (
                  <li
                    key={row.ref}
                    className="flex items-start gap-2 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={pinnedSelected.has(row.ref)}
                      onChange={() => togglePinned(row.ref)}
                      className="mt-1 size-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="shrink-0 font-normal text-[10px]"
                        >
                          {row.type}
                        </Badge>
                        <div className="min-w-0 flex-1 truncate">
                          {row.label}
                        </div>
                      </div>
                      <a
                        href={row.ref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground mt-0.5 block max-w-full truncate text-[11px] hover:underline"
                      >
                        {row.ref}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Attach for this draft
            </h3>
            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void attachUrl();
                }}
                placeholder="Paste Slack / GitHub / Linear / Zendesk URL"
                className="border-input bg-background focus-visible:ring-ring flex-1 rounded-md border px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1"
                disabled={resolving}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void attachUrl()}
                disabled={!urlInput.trim() || resolving}
              >
                {resolving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Attach"
                )}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={pinThis}
                onChange={(e) => setPinThis(e.target.checked)}
                className="size-3.5"
              />
              Pin permanently to this project (so future drafts see it too)
            </label>
            {attached.length > 0 ? (
              <ul className="divide-border divide-y overflow-hidden rounded-md border">
                {attached.map((item) => (
                  <li key={item.ref} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="shrink-0 font-normal text-[10px]"
                        >
                          {item.type}
                        </Badge>
                        <div className="min-w-0 flex-1 truncate">
                          {item.label}
                        </div>
                      </div>
                      <div className="text-muted-foreground mt-0.5 max-w-full truncate text-[11px]">
                        {item.ref}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeAttached(item.ref)}
                      className="size-6 shrink-0"
                      title="Remove"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {!reviewed ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={acknowledgedNoContext}
                onChange={(e) =>
                  setAcknowledgedNoContext(e.target.checked)
                }
                className="size-3.5"
              />
              No extra context — generate without pins or attachments
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={!reviewed || busy}
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 size-3.5" />
            )}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

