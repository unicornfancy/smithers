import { Rocket } from "lucide-react";

import { GenerateLaunchPostButton } from "@/components/generate-launch-post-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  projectSlug: string;
  /** Pre-fill for the dialog's site URL field if present in vault frontmatter. */
  defaultSiteUrl?: string;
}

/**
 * Workbench card for /create-launch-post. Per-project (the artifact is
 * a single launched-<date>.md inside the project's HM folder), placed
 * under partner-profile in the Knowledge tab — the post is a wrap-up
 * artifact that lives alongside partner/project knowledge.
 */
export function ProjectLaunchPostSection({
  projectSlug,
  defaultSiteUrl,
}: Props) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="text-muted-foreground size-4" />
          Launch post
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Draft a Team 51 launch post once the site is live. Pulls together
          partner + project context, your pasted P2/Linear/Slack notes, the
          features you want to highlight, and any lessons-learned to surface
          for A8C product teams. Saves to{" "}
          <code className="bg-muted rounded px-1 font-mono text-[11px]">
            launched-YYYY-MM-DD.md
          </code>{" "}
          in the project&apos;s Hive Mind folder, with images written to{" "}
          <code className="bg-muted rounded px-1 font-mono text-[11px]">
            assets/launched-…/
          </code>
          .
        </p>
        <GenerateLaunchPostButton
          projectSlug={projectSlug}
          defaultSiteUrl={defaultSiteUrl}
          variant="default"
        />
      </CardContent>
    </Card>
  );
}
