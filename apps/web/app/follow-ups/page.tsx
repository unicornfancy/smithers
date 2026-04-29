import { CheckCircle2, Clock } from "lucide-react";

import type { FollowUp } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { ComposeNudgeButton } from "@/components/compose-nudge-button";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentRuntimeStatus } from "@/lib/server/agents";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Follow-ups · Smithers",
};

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const vault = await getVault();
  const status = vault.status();
  const agentStatus = await getAgentRuntimeStatus();

  const { active, resolved } = status.exists
    ? await vault.listFollowUps().catch(() => ({ active: [], resolved: [] }))
    : { active: [], resolved: [] };

  return (
    <>
      <AppHeader
        title="Follow-ups"
        subtitle={
          status.exists
            ? `${active.length} waiting · ${resolved.length} resolved`
            : "Vault not configured yet"
        }
      />
      <PageShell>
        {!status.exists ? (
          <VaultMissingNotice vaultPath={status.vault_path} />
        ) : null}

        {status.exists && active.length === 0 && resolved.length === 0 ? (
          <EmptyState
            title="No follow-ups tracked yet"
            description="Smithers parses Follow-ups.md from your vault. Add rows there or let the vault watcher append them as you draft outbound emails."
          />
        ) : null}

        {active.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="text-muted-foreground size-4" />
                Waiting
                <span className="text-muted-foreground text-xs font-normal">
                  · {active.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FollowUpTable
                rows={active}
                showCompose
                apiKeyConfigured={agentStatus.configured}
              />
            </CardContent>
          </Card>
        ) : null}

        {resolved.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="text-muted-foreground size-4" />
                Resolved
                <span className="text-muted-foreground text-xs font-normal">
                  · {resolved.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FollowUpTable rows={resolved.slice(0, 25)} />
            </CardContent>
          </Card>
        ) : null}
      </PageShell>
    </>
  );
}

interface FollowUpTableProps {
  rows: FollowUp[];
  /** When true, render the per-row Compose-nudge action. */
  showCompose?: boolean;
  apiKeyConfigured?: boolean;
}

function FollowUpTable({
  rows,
  showCompose = false,
  apiKeyConfigured = false,
}: FollowUpTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-[11px] uppercase tracking-wide">
            <th className="py-2 pr-4 font-medium">Project</th>
            <th className="py-2 pr-4 font-medium">Task</th>
            <th className="py-2 pr-4 font-medium">Sent</th>
            <th className="py-2 pr-4 font-medium">Due</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            {showCompose ? <th className="py-2 font-medium">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.follow_up_id}
              className="hover:bg-muted/40 border-b last:border-0"
            >
              <td className="py-2 pr-4 align-top text-xs font-medium">
                {r.project}
              </td>
              <td className="py-2 pr-4 align-top">
                <div className="flex flex-col gap-0.5">
                  <p className="leading-snug">{r.task}</p>
                  {r.status_note ? (
                    <p className="text-muted-foreground text-xs leading-snug">
                      {r.status_note}
                    </p>
                  ) : null}
                </div>
              </td>
              <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums">
                {r.sent}
              </td>
              <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums">
                {r.follow_up_by ?? "—"}
              </td>
              <td className="py-2 pr-4 align-top">
                <span
                  className={
                    r.status === "resolved"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : r.status === "escalated"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-foreground"
                  }
                >
                  {r.status === "resolved"
                    ? "✓ resolved"
                    : r.status === "escalated"
                      ? "⚠ escalated"
                      : "⏳ waiting"}
                </span>
              </td>
              {showCompose ? (
                <td className="py-2 align-top">
                  <ComposeNudgeButton
                    followUpId={r.follow_up_id}
                    apiKeyConfigured={apiKeyConfigured}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
