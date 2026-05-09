import { ActivityLogCard } from "@/components/activity-log-card";
import { AppHeader } from "@/components/app-header";
import { HiveMindReconcileCard } from "@/components/hive-mind-reconcile-card";
import { McpHealthCard } from "@/components/mcp-health-card";
import { PageShell, PlaceholderCard } from "@/components/page-shell";
import { WeeklyUpdateFormatCard } from "@/components/weekly-update-format-card";
import { loadConfig } from "@/lib/server/config";

export const metadata = {
  title: "Settings · Smithers",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = await loadConfig();
  return (
    <>
      <AppHeader title="Settings" subtitle="Identity, paths, MCPs, thresholds" />
      <PageShell>
        <WeeklyUpdateFormatCard
          initialTemplate={cfg.weekly_update?.format_template ?? ""}
        />

        <HiveMindReconcileCard />

        <McpHealthCard />

        <ActivityLogCard />

        <PlaceholderCard
          title="Single long-scroll page with sticky section nav"
          description="Sections: Identity · Paths · MCPs · Transcription · P2 destinations · Working rhythm · Stall thresholds · Follow-up intervals · MCP Health · Skills · Backups & Privacy · About."
          todo={[
            "Read/write config.yaml + per-section local overrides",
            "MCP Health panel: last-success timestamps, 7-day error log, exportable diagnostics",
            "Section deep-links from app header",
          ]}
        />
      </PageShell>
    </>
  );
}
