"use client";

import * as React from "react";
import { Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

import { composeSitrepAction } from "@/app/projects/[slug]/actions";
import type { SitrepOutput } from "@smithers/agents";
import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  projectName: string;
  /**
   * When set, surfaces a small "View P2 post" hint under the dialog title
   * so the user knows where the rendered comment is headed.
   */
  p2Url?: string;
}

/**
 * Workbench affordance: draft a SITREP (Situation Report) as a top-level
 * comment on the project's existing P2 post. Pulls Linear + Zendesk +
 * follow-ups via composeSitrepAction, renders the resulting markdown in
 * an AiDraftDialog for copy-to-clipboard. Nothing posts automatically.
 *
 * No "Save as draft" wiring — the SITREP target is a comment on someone
 * else's P2 (the project's launch post), not a stand-alone vault draft.
 * If the user wants to keep a copy, the comment lives on P2 itself.
 */
export function GenerateSitrepButton({
  projectSlug,
  projectName,
  p2Url,
}: Props) {
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SitrepOutput | null>(null);
  const [lastIntent, setLastIntent] = React.useState("");

  function generate(intent: string) {
    if (pending) return;
    setLastIntent(intent);
    start(async () => {
      try {
        const r = await composeSitrepAction(projectSlug, intent || undefined);
        if (r.ok) {
          setData(r.data);
          setOpen(true);
        } else if (r.reason === "not-configured") {
          toast.error("Set ANTHROPIC_API_KEY in .env.local to enable AI drafts");
        } else {
          toast.error(r.message ?? "Couldn't draft SITREP");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't draft SITREP",
        );
      }
    });
  }

  async function regenerate(intent: string) {
    await new Promise<void>((resolve) =>
      start(async () => {
        try {
          const r = await composeSitrepAction(
            projectSlug,
            intent || undefined,
          );
          if (r.ok) {
            setData(r.data);
            setLastIntent(intent);
          } else {
            toast.error(r.message ?? "Couldn't regenerate SITREP");
          }
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't regenerate",
          );
        } finally {
          resolve();
        }
      }),
    );
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => generate(lastIntent)}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Megaphone className="size-4" />
        )}
        {pending ? "Drafting…" : "Generate SITREP"}
      </Button>
      {data ? (
        <AiDraftDialog
          open={open}
          onOpenChange={setOpen}
          title={`SITREP for ${projectName}`}
          meta={p2Url ? `Target P2: ${p2Url}` : undefined}
          rationale={data.rationale}
          body={data.body}
          onRegenerate={regenerate}
          regenerating={pending}
        />
      ) : null}
    </>
  );
}
