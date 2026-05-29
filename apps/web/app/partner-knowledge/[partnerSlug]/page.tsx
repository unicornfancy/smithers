import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { loadPartnerKnowledgeAction } from "@/app/partner-knowledge/actions";
import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { PartnerKnowledgeEditor } from "@/components/partner-knowledge-editor";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

interface Params {
  partnerSlug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { partnerSlug } = await params;
  return { title: `${partnerSlug} — Partner knowledge · Smithers` };
}

const EMPTY_BODY_SCAFFOLD = `## Summary

(Write a short paragraph about the partner here.)

## Team

(List partner-side contacts.)

## Working notes

(Anything else worth keeping handy — preferences, history, decisions.)
`;

export default async function PartnerKnowledgeEditorPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { partnerSlug } = await params;
  const result = await loadPartnerKnowledgeAction(partnerSlug);

  return (
    <>
      <AppHeader
        title={`Partner knowledge — ${partnerSlug}`}
        subtitle="Edit and commit knowledge/partners/<slug>/partner-knowledge.md"
        actions={
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href="/projects">
              <ArrowLeft className="size-3.5" />
              Projects
            </Link>
          </Button>
        }
      />
      <PageShell>
        {!result.ok ? (
          <p className="text-destructive text-sm">{result.reason}</p>
        ) : (
          <PartnerKnowledgeEditor
            partnerSlug={partnerSlug}
            initialBody={result.data?.body ?? EMPTY_BODY_SCAFFOLD}
            initialFrontmatter={result.data?.frontmatter ?? {}}
            isNewFile={result.data === null}
          />
        )}
      </PageShell>
    </>
  );
}
