"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, RotateCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { retryQaRunWithUrlAction } from "@/app/projects/[slug]/qa/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TestType = "functional-design" | "performance" | "a11y" | "aeo";
type GateType = "coming-soon" | "password" | "private";

interface Props {
  runId: string;
  projectSlug: string;
  testType: TestType;
  /** URL the failed run pointed at — pre-fills the retry input. */
  originalUrl: string;
  /** Parsed from `failure_kind` — e.g. "gated:coming-soon" → "coming-soon". */
  gateType: GateType;
}

const GATE_LABEL: Record<GateType, string> = {
  "coming-soon": "Coming Soon",
  password: "password",
  private: "private",
};

const GATE_HINT: Record<GateType, string> = {
  "coming-soon":
    "The site is still in Coming Soon mode. Kosh's browser sees the launchpad, not the site.",
  password:
    "The site is behind a WordPress password prompt. Kosh's browser sees the password page, not the site.",
  private:
    "The site is marked private on WordPress.com. Kosh's browser sees the private-site notice, not the site.",
};

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

/**
 * Renders when a QA run failed because Kosh v2's reachability-gate
 * check tripped. Explains the specific gate, points at the Share
 * Link workaround inline, and offers a one-click retry with a new
 * URL so the user doesn't have to navigate back to the launcher.
 */
export function QaGateFailedCard({
  runId,
  projectSlug,
  testType,
  originalUrl,
  gateType,
}: Props) {
  const router = useRouter();
  const [url, setUrl] = React.useState(originalUrl);
  const [pending, startTransition] = React.useTransition();

  function retry() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("Enter a URL to retry");
      return;
    }
    if (trimmed === originalUrl.trim()) {
      toast.error(
        "Same URL as the failed run — paste the Share Link URL to bypass the gate",
      );
      return;
    }
    startTransition(async () => {
      const res = await retryQaRunWithUrlAction({
        original_run_id: runId,
        project_slug: projectSlug,
        test_type: testType,
        target_url: trimmed,
      });
      if (res.ok) {
        const behind = res.data.queued_behind;
        toast.success(
          behind === 0
            ? "Started retry"
            : `Queued retry (${behind} ahead)`,
        );
        router.push(`/projects/${projectSlug}/qa/${res.data.run_id}`);
      } else {
        toast.error(res.message ?? res.reason);
      }
    });
  }

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-amber-700 dark:text-amber-300" />
          Site is gated — Kosh needs access to audit
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Kosh v2&apos;s reachability check tripped: this looks like a{" "}
          <span className="font-medium">{GATE_LABEL[gateType]}</span> gate.{" "}
          {GATE_HINT[gateType]}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900/50 dark:bg-sky-950/20">
          <Info className="size-4 shrink-0 text-sky-700 dark:text-sky-300" />
          <div className="space-y-1">
            <p className="font-medium">Workaround: paste a Share Link URL</p>
            <p className="text-muted-foreground">
              The WordPress.com <span className="font-medium">Share Link</span>{" "}
              URL carries access without a login, so it bypasses all three
              gates. In WP-Admin:{" "}
              <span className="font-mono text-[11px]">
                Settings → General → Privacy → Share preview
              </span>
              . Copy the resulting URL and paste it below.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="qa-gate-retry-url"
            className="text-muted-foreground text-xs font-medium uppercase tracking-wide"
          >
            Retry with URL
          </label>
          <input
            id="qa-gate-retry-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={cn(inputClass)}
            disabled={pending}
            placeholder="https://example.com/?share=abc123"
          />
          <p className="text-muted-foreground text-[11px]">
            Pre-filled with the original URL. Replace with the Share Link and
            hit Retry.
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={retry}
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCw className="size-3.5" />
          )}
          {pending ? "Queuing…" : "Retry"}
        </Button>
      </CardContent>
    </Card>
  );
}
