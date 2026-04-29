import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  CalendarClock,
} from "lucide-react";

import { AcceptStallButton } from "@/components/accept-stall-button";
import { ComposeNudgeButton } from "@/components/compose-nudge-button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StallItem, StallSummary } from "@/lib/server/stalls";

interface Props {
  summary: StallSummary;
  apiKeyConfigured: boolean;
}

const ICON_BY_SEVERITY: Record<StallItem["severity"], typeof AlertOctagon> = {
  force_decide: AlertOctagon,
  escalate: AlertTriangle,
  nudge: Bell,
  next_nudge_upcoming: CalendarClock,
};

const TONE_BY_SEVERITY: Record<
  StallItem["severity"],
  "danger" | "warn" | "neutral" | "info"
> = {
  force_decide: "danger",
  escalate: "warn",
  nudge: "neutral",
  next_nudge_upcoming: "info",
};

const SHORT_LABEL_BY_SEVERITY: Record<StallItem["severity"], string> = {
  force_decide: "Decide",
  escalate: "Escalate",
  nudge: "Nudge",
  next_nudge_upcoming: "Touchpoint",
};

/**
 * Project-scoped stall panel — compact. Differs from /today's StallsCard:
 * no per-section blurbs (the row's severity chip carries the meaning),
 * no row-level "Open project" link (we're already on it).
 */
export function NeedsDecisionPanel({ summary, apiKeyConfigured }: Props) {
  if (summary.items.length === 0) return null;

  const headerTone =
    summary.counts.force_decide > 0
      ? "danger"
      : summary.counts.escalate > 0
        ? "warn"
        : summary.counts.next_nudge_upcoming > 0 &&
            summary.counts.nudge === 0
          ? "info"
          : "neutral";

  return (
    <Card
      className={
        headerTone === "danger"
          ? "border-red-200 dark:border-red-900/50"
          : headerTone === "warn"
            ? "border-amber-200 dark:border-amber-900/50"
            : ""
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="text-muted-foreground size-4" />
          Needs decision
          <span className="text-muted-foreground text-xs font-normal">
            · {summary.items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {summary.items.map((item) => (
            <StallRow
              key={item.stall_id}
              item={item}
              apiKeyConfigured={apiKeyConfigured}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function StallRow({
  item,
  apiKeyConfigured,
}: {
  item: StallItem;
  apiKeyConfigured: boolean;
}) {
  const Icon = ICON_BY_SEVERITY[item.severity];
  const tone = TONE_BY_SEVERITY[item.severity];
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2 first:pt-1 last:pb-0">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span
          className={[
            "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            toneClasses(tone),
          ].join(" ")}
        >
          <Icon className="size-2.5" />
          {SHORT_LABEL_BY_SEVERITY[item.severity]}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm leading-snug">{item.title}</p>
          <p className="text-muted-foreground text-xs">{item.context}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.follow_up_id ? (
          <ComposeNudgeButton
            followUpId={item.follow_up_id}
            apiKeyConfigured={apiKeyConfigured}
            toneOverride={severityToTone(item.severity)}
            label={composeLabel(item.severity)}
          />
        ) : null}
        <AcceptStallButton stallId={item.stall_id} label={item.title} />
      </div>
    </li>
  );
}

function severityToTone(
  severity: StallItem["severity"],
): "soft" | "direct" | "force-decide" | undefined {
  switch (severity) {
    case "nudge":
      return "soft";
    case "escalate":
      return "direct";
    case "force_decide":
      return "force-decide";
    case "next_nudge_upcoming":
      return undefined;
  }
}

function composeLabel(severity: StallItem["severity"]): string {
  switch (severity) {
    case "nudge":
      return "Compose nudge";
    case "escalate":
      return "Compose escalation";
    case "force_decide":
      return "Force a decision";
    case "next_nudge_upcoming":
      return "Compose touchpoint";
  }
}

function toneClasses(tone: "danger" | "warn" | "neutral" | "info"): string {
  switch (tone) {
    case "danger":
      return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
    case "warn":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    case "neutral":
      return "bg-muted text-muted-foreground";
    case "info":
      return "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400";
  }
}
