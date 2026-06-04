import { getDefaultAnalyzeCallTranscriptPrompt } from "@smithers/agents";

import { getSetupStatusAction } from "@/app/setup/actions";
import { AboutCard } from "@/components/about-card";
import { ActivityLogCard } from "@/components/activity-log-card";
import { AppHeader } from "@/components/app-header";
import { CallTranscriptPromptCard } from "@/components/call-transcript-prompt-card";
import { FollowUpAutomationCard } from "@/components/follow-up-automation-card";
import { HiveMindReconcileCard } from "@/components/hive-mind-reconcile-card";
import { IntervalJobCard } from "@/components/interval-job-card";
import { McpHealthCard } from "@/components/mcp-health-card";
import { PageShell } from "@/components/page-shell";
import { ScheduleCard } from "@/components/schedule-card";
import { SettingsSection } from "@/components/settings-section";
import { SettingsSetupGroup } from "@/components/settings-setup-group";
import { SettingsTabs, type SettingsTab } from "@/components/settings-tabs";
import { SkillsRegistryCard } from "@/components/skills-registry-card";
import { WeeklyUpdateFormatCard } from "@/components/weekly-update-format-card";
import { WorkbenchLayoutCard } from "@/components/workbench-layout-card";
import { loadConfig } from "@/lib/server/config";
import { findRepoRoot } from "@/lib/server/config-write";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Settings · Smithers",
};

export const dynamic = "force-dynamic";

const TABS: SettingsTab[] = [
  { id: "workflow", label: "Workflow" },
  { id: "setup", label: "Setup" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "skills", label: "Skills" },
  { id: "about", label: "About" },
];

export default async function SettingsPage() {
  const vault = await getVault();
  const [cfg, setupStatus, skills, version] = await Promise.all([
    loadConfig(),
    getSetupStatusAction(),
    vault.listHiveMindSkills().catch(() => []),
    readRootPackageVersion(),
  ]);
  const repoRoot = findRepoRoot();
  const briefingTime =
    cfg.schedule?.daily_briefing?.time ??
    cfg.working_rhythm.briefing_time ??
    "07:30";
  const hiveMindPath = vault.options.hiveMindPath ?? null;

  return (
    <>
      <AppHeader
        title="Settings"
        subtitle="Tune what Smithers does, where it reads from, and how it fires background work."
      />
      <PageShell>
        <SettingsTabs tabs={TABS} defaultTabId="workflow">
          <SettingsSection
            id="workflow"
            title="Workflow"
            description="The daily-tunable knobs — agent prompts, follow-up thresholds, and the background jobs that pre-warm your morning."
          >
            <WorkbenchLayoutCard />
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
            <IntervalJobCard
              job="team_roster_sync"
              title="Team roster sync"
              description="Refreshes the auto-managed Common collaborators block in JOB_CONTEXT.md from the configured Matticspace group (default: team-51, include sub-teams). User-edited intro + post-script content outside the BEGIN/END markers is preserved. Default cadence: weekly."
              runNowPath="/api/jobs/team-roster-sync"
              initial={{
                enabled: cfg.schedule?.team_roster_sync?.enabled ?? false,
                interval_minutes:
                  cfg.schedule?.team_roster_sync?.interval_minutes ??
                  7 * 24 * 60,
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
            description="Slash-command skills Smithers knows about. v1 reads the registry from Hive Mind's .claude/skills/ folder; invocation still happens in a Claude Code session pointed at the HM clone."
          >
            <SkillsRegistryCard
              skills={skills}
              hiveMindPath={hiveMindPath}
            />
          </SettingsSection>

          <SettingsSection
            id="about"
            title="About"
            description="What Smithers is, where the code lives, and how to file an issue."
          >
            <AboutCard
              version={version}
              activeModel={cfg.agents.model}
              repoRoot={repoRoot}
            />
          </SettingsSection>
        </SettingsTabs>
      </PageShell>
    </>
  );
}

async function readRootPackageVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(findRepoRoot(), "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
