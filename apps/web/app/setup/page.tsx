import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { SetupWizard } from "@/components/setup-wizard";

import { getSetupStatusAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup · Smithers" };

export default async function SetupPage() {
  const status = await getSetupStatusAction();
  return (
    <>
      <AppHeader
        title="Setup"
        subtitle="Configure Smithers for your environment"
      />
      <PageShell>
        <SetupWizard initialStatus={status} />
      </PageShell>
    </>
  );
}
