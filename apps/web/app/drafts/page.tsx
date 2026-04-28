import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Drafts · Smithers",
};

export default function DraftsPage() {
  return (
    <>
      <AppHeader
        title="Drafts"
        subtitle="In-flight drafts with original / working / archived states"
      />
      <PageShell>
        <PlaceholderCard
          title="Drafts inbox"
          description="Drafts carry stable UUIDs in frontmatter. The list will show pending drafts grouped by project, with a per-draft status (in-progress / awaiting review / archived)."
          todo={[
            "Read Drafts/, Drafts/Originals/, Drafts/Archived/ via packages/vault",
            "Track stable identity by draft_id (UUID) so files survive renames",
            "Surface AI affordances: 'Draft from task', 'Incorporate reference content', 'Archive (with style learning)'",
          ]}
        />
      </PageShell>
    </>
  );
}
