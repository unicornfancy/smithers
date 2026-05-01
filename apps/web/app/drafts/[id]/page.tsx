import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileEdit } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { DraftEditor } from "@/components/draft-editor";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { decodeDraftIdFromUrl } from "@/lib/draft-id-url";
import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: encoded } = await params;
  const id = decodeDraftIdFromUrl(encoded);
  const vault = await getVault();
  const draft = vault.status().exists
    ? await vault.readDraft(id).catch(() => null)
    : null;
  return {
    title: draft ? `${draft.title} · Drafts` : "Draft · Smithers",
  };
}

export default async function DraftEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: encoded } = await params;
  const id = decodeDraftIdFromUrl(encoded);
  const vault = await getVault();
  if (!vault.status().exists) notFound();

  const draft = await vault.readDraft(id);
  if (!draft) notFound();

  return (
    <>
      <AppHeader
        title={draft.title}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <FileEdit className="size-3.5" />
            {draft.relative_path}
            {draft.project_slug ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <Link
                  href={`/projects/${draft.project_slug}`}
                  className="hover:text-foreground underline-offset-2 hover:underline"
                >
                  {draft.project_slug}
                </Link>
              </>
            ) : null}
            <span className="text-muted-foreground/60">·</span>
            <span>{draft.state === "archived" ? "archived" : "in progress"}</span>
          </span>
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/drafts" className="gap-1.5">
              <ArrowLeft className="size-3.5" />
              All drafts
            </Link>
          </Button>
        }
      />
      <PageShell className="max-w-4xl">
        <DraftEditor
          draftId={draft.draft_id}
          initialBody={draft.body}
          archived={draft.state === "archived"}
        />
      </PageShell>
    </>
  );
}
