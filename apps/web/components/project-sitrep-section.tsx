import { Megaphone } from "lucide-react";

import { GenerateSitrepButton } from "@/components/generate-sitrep-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  projectSlug: string;
  projectName: string;
  p2Url?: string;
}

/**
 * Workbench card for the SITREP composer. Lives on the Knowledge tab
 * because the SITREP is a knowledge-sharing artifact aimed at leads /
 * coverage TAMs, not a daily-flow surface.
 *
 * When the project has no `p2_url` set in frontmatter, the card still
 * renders so the user can generate the markdown and paste it wherever
 * they want — but the dialog won't surface a P2 target hint.
 */
export function ProjectSitrepSection({
  projectSlug,
  projectName,
  p2Url,
}: Props) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="text-muted-foreground size-4" />
          SITREP
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Draft a paste-ready situation report for leads or coverage TAMs.
          Pulls Linear (project + updates + open issues), the primary
          Zendesk thread with recent activity, and your open follow-ups
          into a tight markdown comment{" "}
          {p2Url ? (
            <>
              for the project&apos;s P2 post (
              <a
                href={p2Url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
              >
                view post
              </a>
              ).
            </>
          ) : (
            <>— set <code className="bg-muted rounded px-1 font-mono text-[11px]">p2_url</code> in
            project frontmatter to surface a target link.</>
          )}
        </p>
        <GenerateSitrepButton
          projectSlug={projectSlug}
          projectName={projectName}
          p2Url={p2Url}
        />
      </CardContent>
    </Card>
  );
}
