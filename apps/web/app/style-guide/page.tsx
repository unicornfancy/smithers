import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { StyleGuideEditor } from "@/components/style-guide-editor";
import { getMyVoiceStatusAction, readStyleFileAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Style Guide · Smithers" };

export default async function StyleGuidePage() {
  const [status, initialContent] = await Promise.all([
    getMyVoiceStatusAction(),
    readStyleFileAction("SKILL.md"),
  ]);

  return (
    <>
      <AppHeader
        title="Style Guide"
        subtitle="Voice rules and communication patterns"
      />
      <PageShell>
        <StyleGuideEditor
          initialFilename="SKILL.md"
          initialContent={initialContent}
          configured={status.configured}
          myVoicePath={status.path}
        />
      </PageShell>
    </>
  );
}
