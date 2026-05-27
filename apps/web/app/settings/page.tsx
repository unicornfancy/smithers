import { getDefaultAnalyzeCallTranscriptPrompt } from "@smithers/agents";

import { getSetupStatusAction } from "@/app/setup/actions";
import { ActivityLogCard } from "@/components/activity-log-card";
import { AppHeader } from "@/components/app-header";
import { CallTranscriptPromptCard } from "@/components/call-transcript-prompt-card";
import { FollowUpAutomationCard } from "@/components/follow-up-automation-card";
import { HiveMindReconcileCard } from "@/components/hive-mind-reconcile-card";
import { IntervalJobCard } from "@/components/interval-job-card";
import { McpHealthCard } from "@/components/mcp-health-card";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { ScheduleCard } from "@/components/schedule-card";
import { SettingsLayout } from "@/components/settings-layout";
import { SettingsSection } from "@/components/settings-section";
import { SettingsSetupGroup } from "@/components/settings-setup-group";
import { WeeklyUpdateFormatCard } from "@/components/weekly-update-format-card";
import { loadConfig } from "@/lib/server/config";

export const metadata = {
  title: "Settings · Smithers",
};

export const dynamic = "force-dynamic";

const NAV_SECTIONS = [
  { id: "workflow", label: "Workflow" },
  { id: "setup", label: "Setup" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "skills", label: "Skills" },
  { id: "about", label: "About" },
];

export default async function SettingsPage() {
  const [cfg, setupStatus] = await Promise.all([
    loadConfig(),
    getSetupStatusAction(),
  ]);
  const briefingTime =
    cfg.schedule?.daily_briefing?.time ??
    cfg.working_rhythm.briefing_time ??
    "07:30";

  return (
    <>
      <AppHeader
        title="Settings"
        subtitle="Tune what Smithers does, where it reads from, and how it fires background work."
      />
      <PageShell>
        <SettingsLayout sections={NAV_SECTIONS}>
          <SettingsSection
            id="workflow"
            title="Workflow"
            description="The daily-tunable knobs — agent prompts, follow-up thresholds, and the background jobs that pre-warm your morning."
          >
            <WeeklyUpdateFormatCard
              initialTemplate={cfg.weekly_update?.format_template ?? ""}
            />
            <CallTranscriptPromptCard
              initialPrompt={cfg.agents.analyze_call_transcript_prompt ?? ""}
              defaultPrompt={getDefaultAnalyzeCallTranscriptPrompt()}
            />
            <FollowUpAutomationCard
              initial={{
                follow_up_nudge_days:
                  cfg.stall_thresholds.follow_up_nudge_days,
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
          </SettingsSection>

          <SettingsSection
            id="setup"
            title="Setup"
            description="The set-once values: who you are, where your files live, which MCPs to run. The /setup wizard exposes the same fields for first-run."
          >
            <SettingsSetupGroup initialStatus={setupStatus} />
          </SettingsSection>

          <SettingsSection
            id="diagnostics"
            title="Diagnostics"
            description="Live MCP health, Hive Mind reconcile, and the audit log of everything Smithers has been told to do."
          >
            <McpHealthCard />
            <HiveMindReconcileCard />
            <ActivityLogCard />
          </SettingsSection>

          <SettingsSection
            id="skills"
            title="Skills"
            description="Skills that Smithers can invoke. The project-brief skill lands before v1; this is where future skills register."
          >
            <PlaceholderCard
              title="Skills registry"
              description="Once the /create-brief skill is wired through Smithers (PLAN.md: project briefs — attach affordance + skill integration), this card lists every registered skill with last-run status."
              todo={[
                "Wire /create-brief skill into the workbench brief card.",
                "Capture skill registration in config so toggles can disable individual skills.",
                "Add 'Run skill manually' affordance per row.",
              ]}
            />
          </SettingsSection>

          <SettingsSection
            id="about"
            title="About"
            description="What Smithers is, where the code lives, and how to file an issue."
          >
            <PlaceholderCard
              title="About Smithers"
              description="Stub for a tiny info card: version, repo link, README + ONBOARDING shortcuts, identity of the running Anthropic model. Low priority — fill in when it bothers you."
            />
          </SettingsSection>
        </SettingsLayout>
      </PageShell>
    </>
  );
}
