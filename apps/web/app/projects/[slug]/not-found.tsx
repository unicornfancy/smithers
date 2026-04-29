import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <>
      <AppHeader title="Project not found" subtitle="Unknown slug" />
      <PageShell>
        <EmptyState
          title="No matching project"
          description="That slug didn't match a project in your vault. The URL might be stale, or the project was renamed."
          action={
            <Button asChild size="sm">
              <Link href="/projects">Back to projects</Link>
            </Button>
          }
        />
      </PageShell>
    </>
  );
}
