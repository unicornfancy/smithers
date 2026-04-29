import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  CalendarClock,
} from "lucide-react";

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

const SECTIONS: ReadonlyArray<{
  severity: StallItem["severity"];
  label: string;
  /** One-line context shown beneath the section title. */
  blurb: string;
  /** Border accent color for the section header chip. */
  tone: "danger" | "warn" | "neutral" | "info";
  Icon: typeof AlertOctagon;
}> = [
  {
    severity: "force_decide",
    label: "Force a decision",
    blurb: "30+ days waiting. Decide today: change channel, change person, or accept the stall.",
    tone: "danger",
    Icon: AlertOctagon,
  },
  {
    severity: "escalate",
    label: "Escalate or accept",
    blurb: "21+ days waiting. Try a different channel or person, or deprioritize.",
    tone: "warn",
    Icon: AlertTriangle,
  },
  {
    severity: "nudge",
    label: "Send a nudge",
    blurb: "10+ days waiting. A soft check-in is appropriate.",
    tone: "neutral",
    Icon: Bell,
  },
  {
    severity: "next_nudge_upcoming",
    label: "Touchpoint reminder",
    blurb: "Cold projects with a scheduled annual or seasonal nudge approaching.",
    tone: "info",
    Icon: CalendarClock,
  },
];

export function StallsCard({ summary, apiKeyConfigured }: Props) {
  if (summary.items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="text-muted-foreground size-4" />
          Stalls &amp; Closures
          <span className="text-muted-foreground text-xs font-normal">
            · {summary.items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {SECTIONS.map((section) => {
          const items = summary.items.filter(
            (i) => i.severity === section.severity,
          );
          if (items.length === 0) return null;
          return (
            <StallSection
              key={section.severity}
              label={section.label}
              blurb={section.blurb}
              tone={section.tone}
              Icon={section.Icon}
              items={items}
              apiKeyConfigured={apiKeyConfigured}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

interface SectionProps {
  label: string;
  blurb: string;
  tone: "danger" | "warn" | "neutral" | "info";
  Icon: typeof AlertOctagon;
  items: StallItem[];
  apiKeyConfigured: boolean;
}

function StallSection({
  label,
  blurb,
  tone,
  Icon,
  items,
  apiKeyConfigured,
}: SectionProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
            toneClasses(tone),
          ].join(" ")}
        >
          <Icon className="size-3" />
          {label}
          <span className="opacity-70">· {items.length}</span>
        </span>
        <span className="text-muted-foreground text-xs">{blurb}</span>
      </div>
      <ul className="flex flex-col divide-y">
        {items.map((item) => (
          <StallRow
            key={item.stall_id}
            item={item}
            apiKeyConfigured={apiKeyConfigured}
          />
        ))}
      </ul>
    </div>
  );
}

function StallRow({
  item,
  apiKeyConfigured,
}: {
  item: StallItem;
  apiKeyConfigured: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2 first:pt-1 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm leading-snug">{item.title}</p>
        <p className="text-muted-foreground text-xs">{item.context}</p>
      </div>
      <div className="flex items-center gap-1">
        {item.follow_up_id ? (
          <ComposeNudgeButton
            followUpId={item.follow_up_id}
            apiKeyConfigured={apiKeyConfigured}
            toneOverride={severityToTone(item.severity)}
            label={severityLabel(item.severity)}
          />
        ) : null}
        {item.project_slug ? (
          <Link
            href={`/projects/${item.project_slug}` as never}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          >
            Open project
          </Link>
        ) : null}
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

function severityLabel(severity: StallItem["severity"]): string {
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
