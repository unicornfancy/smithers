import { AfkComposer } from "@/components/afk-composer";
import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { loadConfig } from "@/lib/server/config";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "AFK · Smithers",
};

export const dynamic = "force-dynamic";

export default async function AfkPage() {
  const cfg = await loadConfig();
  const vault = await getVault();
  const allProjects = await vault.listProjects().catch(() => []);
  const inScope = allProjects.filter(
    (p) =>
      (p.kind === "partner" || p.kind === "team") &&
      (p.status === "active" || p.status === "hot" || p.status === "at-risk"),
  );

  return (
    <>
      <AppHeader
        title="AFK"
        subtitle="Draft a coverage handoff post before you go on PTO"
      />
      <PageShell>
        <AfkComposer
          projectCount={inScope.length}
          projectNames={inScope.map((p) => p.name)}
          authorName={cfg.identity.name ?? ""}
        />
      </PageShell>
    </>
  );
}
