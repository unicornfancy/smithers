"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { refreshPingsActionedAction } from "@/app/today/actions";
import type { PingActionedInput } from "@/lib/server/ping-actioned";
import { Button } from "@/components/ui/button";

interface Props {
  pings: PingActionedInput[];
  /** ISO timestamp of the most-recent ping_actioned check, if any. */
  checkedAt: string | null;
}

export function RefreshPingsActionedButton({ pings, checkedAt }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await refreshPingsActionedAction(pings);
        toast.success(
          `Checked ${result.checked} ping${result.checked === 1 ? "" : "s"} · ${result.actioned} already replied`,
        );
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to refresh",
        );
      }
    });
  }

  return (
    <span className="flex items-center gap-1.5">
      {checkedAt ? (
        <span className="text-[10px]" title={`Last checked ${checkedAt}`}>
          checked {formatRelative(checkedAt)}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-[11px]"
        onClick={handleClick}
        disabled={pending || pings.length === 0}
        title="Re-check Slack/Zendesk/GitHub for replies you've already sent"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
        {pending ? "Checking…" : "Refresh"}
      </Button>
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const seconds = Math.floor((Date.now() - d.valueOf()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
