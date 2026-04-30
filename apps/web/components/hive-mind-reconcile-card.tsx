import {
  AlertCircle,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Network,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HiveMindReconcileButton } from "@/components/hive-mind-reconcile-button";
import { buildReconcileSummary } from "@/lib/server/hive-mind-reconcile";

export async function HiveMindReconcileCard() {
  const summary = await buildReconcileSummary();

  if (!summary.hive_mind_available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="text-muted-foreground size-4" />
            Hive Mind reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Hive Mind clone not detected.{" "}
            {summary.hive_mind_unavailable_reason ?? "Unavailable."} Set{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
              paths.hive_mind
            </code>{" "}
            in your config to point at the local clone.
          </p>
        </CardContent>
      </Card>
    );
  }

  const missingCount = summary.vault_partners.filter(
    (p) => !p.hive_mind_present,
  ).length;

  return (
    <Card
      className={
        missingCount > 0
          ? "border-amber-200 dark:border-amber-900/50"
          : ""
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="text-muted-foreground size-4" />
          Hive Mind reconciliation
          {missingCount > 0 ? (
            <span className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">
              <CircleAlert className="size-3" />
              {missingCount} missing
            </span>
          ) : null}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Cross-checks vault partner-kind projects against Hive Mind&rsquo;s
          knowledge/partners/ directories. &ldquo;Add to Hive Mind&rdquo;
          writes a partner-knowledge.md from the existing template; you
          review the diff and commit it manually with your normal Hive
          Mind flow.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <VaultPartnersTable summary={summary} />
        <HiveMindPartnersList summary={summary} />
      </CardContent>
    </Card>
  );
}

function VaultPartnersTable({
  summary,
}: {
  summary: Awaited<ReturnType<typeof buildReconcileSummary>>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-foreground text-sm font-medium">
        Vault partner projects ·{" "}
        <span className="text-muted-foreground font-normal">
          {summary.vault_partners.length}
        </span>
      </h3>
      {summary.vault_partners.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          No partner-kind projects in your vault yet. When you add one
          (manually or via the future Linear-driven create-project flow),
          it&rsquo;ll surface here with its Hive Mind status.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-[11px] uppercase tracking-wide">
                <th className="py-2 pr-4 font-medium">Partner</th>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Hive Mind</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {summary.vault_partners.map((p) => (
                <tr
                  key={p.project_id}
                  className="hover:bg-muted/40 border-b last:border-0"
                >
                  <td className="py-2 pr-4 align-top">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-foreground text-sm font-medium">
                        {p.display_name}
                      </span>
                      <code className="text-muted-foreground font-mono text-[11px]">
                        {p.partner_slug}
                      </code>
                    </div>
                  </td>
                  <td className="text-muted-foreground py-2 pr-4 align-top text-xs">
                    {p.project.name}
                  </td>
                  <td className="py-2 pr-4 align-top">
                    {p.hive_mind_present ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        in sync
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                        <AlertCircle className="size-3" />
                        missing
                      </span>
                    )}
                  </td>
                  <td className="py-2 align-top">
                    {!p.hive_mind_present ? (
                      <HiveMindReconcileButton
                        partnerSlug={p.partner_slug}
                        displayName={p.display_name}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HiveMindPartnersList({
  summary,
}: {
  summary: Awaited<ReturnType<typeof buildReconcileSummary>>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-foreground flex items-center gap-1.5 text-sm font-medium">
        <GitBranch className="text-muted-foreground size-3.5" />
        Hive Mind partners ·{" "}
        <span className="text-muted-foreground font-normal">
          {summary.hive_mind_partners.length}
        </span>
      </h3>
      <p className="text-muted-foreground text-xs">
        Existing partner directories under{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
          knowledge/partners/
        </code>
        . Read-only reference.
      </p>
      {summary.hive_mind_partners.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">
          No partner directories found.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {summary.hive_mind_partners.map((p) => (
            <li
              key={p.slug}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="text-foreground truncate">
                {p.title ?? p.slug}
              </span>
              {p.nda ? (
                <span
                  className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 shrink-0 rounded px-1 text-[10px] font-medium uppercase"
                  title="NDA partner"
                >
                  NDA
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
