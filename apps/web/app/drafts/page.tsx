import Link from "next/link";
import { Archive, FileEdit, PenLine } from "lucide-react";

import type { Draft } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { EmptyState, VaultMissingNotice } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { encodeDraftIdForUrl } from "@/lib/draft-id-url";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Drafts · Smithers",
};

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const vault = await getVault();
  const status = vault.status();

  const drafts = status.exists ? await vault.listDrafts().catch(() => []) : [];
  const inProgress = drafts.filter((d) => d.state === "in-progress");
  const archived = drafts.filter((d) => d.state === "archived");

  return (
    <>
      <AppHeader
        title="Drafts"
        subtitle={
          status.exists
            ? `${inProgress.length} in flight · ${archived.length} archived`
            : "Vault not configured yet"
        }
      />
      <PageShell>
        {!status.exists ? (
          <VaultMissingNotice vaultPath={status.vault_path} />
        ) : null}

        {status.exists && drafts.length === 0 ? (
          <EmptyState
            title="No drafts yet"
            description="Drafts will appear here once you add files under Drafts/ in your vault, or once Smithers' AI 'Draft from task' affordance lands."
          />
        ) : null}

        {inProgress.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PenLine className="text-muted-foreground size-4" />
                In flight
                <span className="text-muted-foreground text-xs font-normal">
                  · {inProgress.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {inProgress.map((d) => (
                <DraftRow key={d.draft_id} draft={d} />
              ))}
            </CardContent>
          </Card>
        ) : null}

        {archived.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Archive className="text-muted-foreground size-4" />
                Archived
                <span className="text-muted-foreground text-xs font-normal">
                  · {archived.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {archived.slice(0, 12).map((d) => (
                <DraftRow key={d.draft_id} draft={d} />
              ))}
            </CardContent>
          </Card>
        ) : null}
      </PageShell>
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  return (
    <Link
      href={`/drafts/${encodeDraftIdForUrl(draft.draft_id)}`}
      className="hover:bg-muted/40 -mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-3 transition-colors"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileEdit className="text-muted-foreground size-3.5 shrink-0" />
          <p className="truncate text-sm font-medium leading-snug">
            {draft.title}
          </p>
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {draft.relative_path}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {draft.original_path ? (
          <Badge variant="outline" className="text-[10px]">
            has original
          </Badge>
        ) : null}
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {formatDate(draft.modified_at)}
        </span>
      </div>
    </Link>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  const now = new Date();
  const days = Math.floor((now.valueOf() - d.valueOf()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
