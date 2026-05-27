import { getDefaultAnalyzeCallTranscriptPrompt } from "@smithers/agents";

import { ActivityLogCard } from "@/components/activity-log-card";
import { AppHeader } from "@/components/app-header";
import { CallTranscriptPromptCard } from "@/components/call-transcript-prompt-card";
import { FollowUpAutomationCard } from "@/components/follow-up-automation-card";
import { HiveMindReconcileCard } from "@/components/hive-mind-reconcile-card";
import { IntervalJobCard } from "@/components/interval-job-card";
import { McpHealthCard } from "@/components/mcp-health-card";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { ScheduleCard } from "@/components/schedule-card";
import { WeeklyUpdateFormatCard } from "@/components/weekly-update-format-card";
import { loadConfig } from "@/lib/server/config";

export const metadata = {
  title: "Settings · Smithers",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = await loadConfig();
  const briefingTime =
    cfg.schedule?.daily_briefing?.time ??
    cfg.working_rhythm.briefing_time ??
    "07:30";

  return (
    <>
      <AppHeader title="Settings" subtitle="Identity, paths, MCPs, thresholds" />
      <PageShell>
        <WeeklyUpdateFormatCard
          initialTemplate={cfg.weekly_update?.format_template ?? ""}
        />

        <CallTranscriptPromptCard
          initialPrompt={cfg.agents.analyze_call_transcript_prompt ?? ""}
          defaultPrompt={getDefaultAnalyzeCallTranscriptPrompt()}
        />

        <FollowUpAutomationCard
          initial={{
            follow_up_nudge_days: cfg.stall_thresholds.follow_up_nudge_days,
            follow_up_escalate_days:
              cfg.stall_thresholds.follow_up_escalate_days,
            follow_up_force_decide_days:
              cfg.stall_thresholds.follow_up_force_decide_days,
            next_nudge_lookahead_days:
              cfg.stall_thresholds.next_nudge_lookahead_days,
            default_window_days: cfg.follow_ups?.default_window_days ?? 7,
          }}
        />

        <ScheduleCard
          initial={{
            enabled: cfg.schedule?.daily_briefing?.enabled ?? false,
            time: briefingTime,
          }}
        />

        <IntervalJobCard
          job="ping_monitor"
          title="Ping monitor"
          description="Re-checks every Pings to Action item to see if you've already replied, so the feed auto-hides done items without clicking Refresh. Cheap per run."
          runNowPath="/api/jobs/ping-monitor"
          initial={{
            enabled: cfg.schedule?.ping_monitor?.enabled ?? false,
            interval_minutes:
              cfg.schedule?.ping_monitor?.interval_minutes ?? 15,
          }}
        />

        <IntervalJobCard
          job="fathom_sync"
          title="Fathom sync"
          description="Warms the recordings cache so /calls and Recent Calls on /today show new meetings without opening the page."
          runNowPath="/api/jobs/fathom-sync"
          initial={{
            enabled: cfg.schedule?.fathom_sync?.enabled ?? false,
            interval_minutes:
              cfg.schedule?.fathom_sync?.interval_minutes ?? 60,
          }}
        />

        <IntervalJobCard
          job="hive_mind_sync"
          title="Hive Mind sync"
          description="Runs `git pull --ff-only` on the Hive Mind clone so other TAMs' edits land automatically. Skips if your local tree is dirty."
          runNowPath="/api/jobs/hive-mind-sync"
          initial={{
            enabled: cfg.schedule?.hive_mind_sync?.enabled ?? false,
            interval_minutes:
              cfg.schedule?.hive_mind_sync?.interval_minutes ?? 30,
          }}
        />

        <HiveMindReconcileCard />

        <McpHealthCard />

        <ActivityLogCard />

        <PlaceholderCard
          title="Single long-scroll page with sticky section nav"
          description="Sections: Identity · Paths · MCPs · Transcription · P2 destinations · Working rhythm · MCP Health · Skills · Backups & Privacy · About."
          todo={[
            "Identity / paths / MCP toggles are live on /setup; merge those cards here once /setup graduates from first-run wizard.",
            "Sticky section nav from app header.",
          ]}
        />
      </PageShell>
    </>
  );
}
