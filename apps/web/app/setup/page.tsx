import { AppHeader } from "@/components/app-header";
import { PageShell, PlaceholderCard } from "@/components/page-shell";

export const metadata = {
  title: "Setup · Smithers",
};

export default function SetupPage() {
  return (
    <>
      <AppHeader title="First-run setup" subtitle="8-step onboarding wizard" />
      <PageShell>
        <PlaceholderCard
          title="Welcome"
          description="A short tour and privacy summary. Then: Identity → Vault path → Hive Mind path (skippable) → Transcription provider → Live data MCP detection → Initial test sync → Done."
          todo={[
            "Auto-detect Obsidian vaults (~/Library/Application Support/obsidian/obsidian.json)",
            "Or any markdown folder",
            "Or 'Create new vault from templates' (no Obsidian required)",
          ]}
        />
      </PageShell>
    </>
  );
}
