"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  Info,
  ListPlus,
  Loader2,
  PlayCircle,
  Sparkles,
  StopCircle,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelQaRunAction,
  ingestQaRunAction,
  queueAllQaRunsAction,
  startQaRunAction,
} from "@/app/projects/[slug]/qa/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TestType = "functional-design" | "performance" | "a11y" | "aeo";
type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface PendingRun {
  id: string;
  test_type: TestType;
  target_url: string;
  status: RunStatus;
  started_at: string;
}

interface Props {
  projectSlug: string;
  stagingUrl: string;
  productionUrl: string;
  detection: {
    ready: boolean;
    reason: string | null;
    claudeCli: string | null;
    koshPath: string | null;
  };
  pendingRuns: PendingRun[];
}

const TEST_LABEL: Record<TestType, string> = {
  "functional-design": "Functional & design",
  performance: "Performance",
  a11y: "Accessibility",
  aeo: "AEO",
};

export function QaLauncherCard({
  projectSlug,
  stagingUrl,
  productionUrl,
  detection,
  pendingRuns,
}: Props) {
  const router = useRouter();
  const [url, setUrl] = React.useState(stagingUrl || productionUrl);
  const [pendingType, setPendingType] = React.useState<TestType | null>(null);
  const [pendingIngestType, setPendingIngestType] = React.useState<TestType | null>(null);
  const [queueingAll, setQueueingAll] = React.useState(false);

  const activeRun = pendingRuns.find((r) => r.status === "running") ?? null;
  const queuedRuns = pendingRuns.filter((r) => r.status === "queued");

  React.useEffect(() => {
    // Light polling while anything is in flight — refreshes the page
    // so queued runs walk forward and history picks up results.
    if (pendingRuns.length === 0) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [pendingRuns.length, router]);

  const disabled = !detection.ready;

  async function handleStart(type: TestType) {
    if (!url.trim()) {
      toast.error("Pick a URL first");
      return;
    }
    setPendingType(type);
    try {
      const res = await startQaRunAction({
        project_slug: projectSlug,
        test_type: type,
        target_url: url.trim(),
      });
      if (res.ok) {
        const behind = res.data.queued_behind;
        toast.success(
          behind === 0
            ? `Started ${TEST_LABEL[type]} test`
            : `Queued ${TEST_LABEL[type]} (${behind} ahead)`,
        );
        router.refresh();
      } else {
        toast.error(res.message ?? res.reason);
      }
    } finally {
      setPendingType(null);
    }
  }

  async function handleQueueAll() {
    if (!url.trim()) {
      toast.error("Pick a URL first");
      return;
    }
    setQueueingAll(true);
    try {
      const res = await queueAllQaRunsAction({
        project_slug: projectSlug,
        target_url: url.trim(),
      });
      if (res.ok) {
        toast.success("Queued all 4 audits");
        router.refresh();
      } else {
        toast.error(res.message ?? res.reason);
      }
    } finally {
      setQueueingAll(false);
    }
  }

  async function handleIngest(type: TestType) {
    if (!url.trim()) {
      toast.error("Pick a URL first — we record it against the run");
      return;
    }
    setPendingIngestType(type);
    try {
      const res = await ingestQaRunAction({
        project_slug: projectSlug,
        test_type: type,
        target_url: url.trim(),
      });
      if (res.ok) {
        toast.success(`Imported latest ${TEST_LABEL[type]} report`);
        router.refresh();
      } else {
        toast.error(res.message ?? res.reason);
      }
    } finally {
      setPendingIngestType(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" />
          Run a QA audit
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Smithers shells out to <code>claude --plugin-dir kosh</code> against the
          URL below. Reports save into the partner&apos;s Hive Mind under{" "}
          <code>Kosh Reports/</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ComingSoonTip />
        <div className="space-y-2">
          <label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Target URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.staging.wpcomstaging.com"
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "w-full rounded-md border px-3 py-2 font-mono text-sm",
              "focus-visible:outline-none focus-visible:ring-1",
            )}
            disabled={disabled}
          />
          <div className="flex flex-wrap gap-2 text-xs">
            {stagingUrl ? (
              <UrlPreset label="Staging" url={stagingUrl} onClick={setUrl} />
            ) : null}
            {productionUrl ? (
              <UrlPreset label="Production" url={productionUrl} onClick={setUrl} />
            ) : null}
          </div>
        </div>

        {!detection.ready ? (
          <NotReadyBanner reason={detection.reason} />
        ) : null}

        {pendingRuns.length > 0 ? (
          <div className="space-y-1.5">
            {activeRun ? (
              <PendingRunRow
                run={activeRun}
                slug={projectSlug}
                label={`Running: ${TEST_LABEL[activeRun.test_type]}`}
                tone="active"
              />
            ) : null}
            {queuedRuns.map((q, i) => (
              <PendingRunRow
                key={q.id}
                run={q}
                slug={projectSlug}
                label={`Up next${queuedRuns.length > 1 ? ` (#${i + 1})` : ""}: ${TEST_LABEL[q.test_type]}`}
                tone="queued"
              />
            ))}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
          {(["functional-design", "performance", "a11y", "aeo"] as TestType[]).map((t) => (
            <Button
              key={t}
              variant="default"
              size="sm"
              disabled={disabled || pendingType !== null || queueingAll}
              onClick={() => handleStart(t)}
              className="justify-start gap-2"
            >
              {pendingType === t ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PlayCircle className="size-3.5" />
              )}
              {TEST_LABEL[t]}
            </Button>
          ))}
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || queueingAll || pendingType !== null}
          onClick={handleQueueAll}
          className="w-full justify-center gap-2"
        >
          {queueingAll ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ListPlus className="size-3.5" />
          )}
          Queue all four (runs sequentially)
        </Button>

        <details className="text-muted-foreground border-t pt-3 text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
            <Terminal className="size-3.5" />
            Manual fallback (already ran kosh elsewhere)
          </summary>
          <div className="pt-3 space-y-2">
            <p>
              If you ran <code>/kosh:&lt;type&gt; {url || "<url>"}</code> in your own
              Claude session, click Import to pull the freshest{" "}
              <code>reports/data/qa-report-*.json</code> from your kosh dir into
              this project&apos;s Hive Mind.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["functional-design", "performance", "a11y", "aeo"] as TestType[]).map(
                (t) => (
                  <Button
                    key={t}
                    variant="outline"
                    size="sm"
                    disabled={pendingIngestType !== null}
                    onClick={() => handleIngest(t)}
                    className="justify-start gap-2"
                  >
                    {pendingIngestType === t ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Import {TEST_LABEL[t]}
                  </Button>
                ),
              )}
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function PendingRunRow({
  run,
  slug,
  label,
  tone,
}: {
  run: PendingRun;
  slug: string;
  label: string;
  tone: "active" | "queued";
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = React.useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await cancelQaRunAction({
        run_id: run.id,
        project_slug: slug,
      });
      if (res.ok) {
        toast.success(tone === "active" ? "Cancelled run" : "Removed from queue");
        router.refresh();
      } else {
        toast.error(res.message ?? res.reason);
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border p-3",
        tone === "active"
          ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50"
          : "bg-muted/30",
      )}
    >
      {tone === "active" ? (
        <Loader2 className="text-amber-700 dark:text-amber-300 size-4 shrink-0 animate-spin" />
      ) : (
        <Clock className="text-muted-foreground size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground truncate text-xs">
          {run.target_url}
        </p>
      </div>
      <Button asChild size="sm" variant="ghost">
        <a href={`/projects/${slug}/qa/${run.id}`}>View</a>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={handleCancel}
        disabled={cancelling}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        title={tone === "active" ? "Stop this run" : "Remove from queue"}
      >
        {cancelling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <StopCircle className="size-3.5" />
        )}
        Cancel
      </Button>
    </div>
  );
}

function UrlPreset({
  label,
  url,
  onClick,
}: {
  label: string;
  url: string;
  onClick: (u: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(url)}
      className="text-muted-foreground hover:text-foreground rounded-full border px-2 py-0.5 transition-colors"
    >
      Use {label}
    </button>
  );
}

function ComingSoonTip() {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900/50 dark:bg-sky-950/20">
      <Info className="size-4 shrink-0 text-sky-700 dark:text-sky-300" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium text-foreground">
          Site gated? (Coming Soon, password, private)
        </p>
        <p className="text-muted-foreground">
          Kosh v2 detects Coming Soon / password / private-mode pages and
          pauses for interactive auth. Smithers runs Kosh non-interactively
          (subprocess with{" "}
          <code className="font-mono text-[11px]">--print</code>) so the
          pause hangs the run — you&apos;ll see it queued until you cancel.
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium">Workaround:</span> paste a
          WordPress.com{" "}
          <span className="font-medium">Share Link</span> URL that carries
          access — it bypasses the gate. Find it under{" "}
          <span className="font-mono text-[11px]">
            Settings → General → Privacy → Share preview
          </span>
          . For unattended runs (queue-all), only Share Link URLs work
          today.
        </p>
      </div>
    </div>
  );
}

function NotReadyBanner({ reason }: { reason: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <AlertTriangle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 space-y-1 text-xs">
        <p className="font-medium">Kosh launcher not ready.</p>
        <p className="text-muted-foreground">
          {reason ??
            "Smithers can't find the claude CLI or your local kosh clone."}
        </p>
        <p className="text-muted-foreground">
          You can still use Import (below) after running kosh yourself, or set{" "}
          <code>paths.kosh</code> in config and{" "}
          <code>npm i -g @anthropic-ai/claude-code</code> to enable launching from
          here.
        </p>
      </div>
    </div>
  );
}
