import { AppHeader } from "@/components/app-header";
import { NewProjectForm } from "@/components/new-project-form";
import { PageShell } from "@/components/page-shell";

export const metadata = {
  title: "New project · Smithers",
};

export const dynamic = "force-dynamic";

export default function NewProjectPage() {
  return (
    <>
      <AppHeader
        title="New project"
        subtitle="Drop a markdown file with the right frontmatter into your vault"
      />
      <PageShell className="max-w-3xl">
        <NewProjectForm />
      </PageShell>
    </>
  );
}
