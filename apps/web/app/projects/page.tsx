import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Projects · Smithers",
};

export default function ProjectsPage() {
  return (
    <>
      <AppHeader
        title="Projects"
        subtitle="Partner, team, and personal projects in one place"
      />
      <PageShell>
        <PlaceholderCard
          title="Project list"
          description="A unified list of projects merged from Hive Mind (partner kind), your vault's Projects/ folder (team + personal kinds), and active drafts. Filterable by kind, status, and recent activity."
          todo={[
            "Query Hive Mind via packages/mcp-client",
            "Read vault Projects/<slug>/info.md frontmatter via packages/vault",
            "Compose unified Project[] type across sources",
          ]}
        />
        <PlaceholderCard
          title="New Project"
          description="Three creation paths: partner (writes to Hive Mind), team (vault), personal (vault)."
        />
      </PageShell>
    </>
  );
}
