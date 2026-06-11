"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, PlayCircle, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";

import {
  ingestQaRunAction,
  startQaRunAction,
} from "@/app/projects/[slug]/qa/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TestType = "functional-design" | "performance" | "a11y";
type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface ActiveRun {
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
  activeRun: ActiveRun | null;
}

const TEST_LABEL: Record<TestType, string> = {
  "functional-design": "Functional & design",
  performance: "Performance",
  a11y: "Accessibility",
};

export function QaLauncherCard({
  projectSlug,
  stagingUrl,
  productionUrl,
  detection,
  activeRun,
}: Props) {
  const router = useRouter();
  const [url, setUrl] = React.useState(stagingUrl || productionUrl);
  const [pendingType, setPendingType] = React.useState<TestType | null>(null);
  const [pendingIngestType, setPendingIngestType] = React.useState<TestType | null>(null);

  React.useEffect(() => {
    // Light polling while a run is active — refreshes the page so the
    // active-run state walks forward and history picks up the result.
    if (!activeRun) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [activeRun, router]);

  const disabled = !detection.ready || Boolean(activeRun);

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
        toast.success(`Started ${TEST_LABEL[type]} test`);
        router.refresh();
      } else {
        toast.error(res.message ?? res.reason);
      }
    } finally {
      setPendingType(null);
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

        {activeRun ? (
          <div className="bg-muted/40 flex items-center gap-3 rounded-md border p-3">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {TEST_LABEL[activeRun.test_type]} test{" "}
                <span className="text-muted-foreground font-normal">
                  · {activeRun.status}
                </span>
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {activeRun.target_url}
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <a href={`/projects/${projectSlug}/qa/${activeRun.id}`}>View</a>
            </Button>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          {(["functional-design", "performance", "a11y"] as TestType[]).map((t) => (
            <Button
              key={t}
              variant="default"
              size="sm"
              disabled={disabled || pendingType !== null}
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
              {(["functional-design", "performance", "a11y"] as TestType[]).map(
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
