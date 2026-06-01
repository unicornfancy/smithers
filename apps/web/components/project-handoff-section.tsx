import { UserCheck } from "lucide-react";

import { GenerateHandoffButton } from "@/components/generate-handoff-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  projectSlug: string;
  preparedBy: string;
}

/**
 * Bottom-of-page card for the /project-handoff skill. Used only when
 * the project is moving to another TAM — kept out of the daily-flow
 * surfaces and placed at the end of the workbench so it doesn't
 * clutter the working sections. The same skill is also reachable from
 * the workbench header's "Handoff" quick-action button; this card is
 * the discoverable / primary surface.
 */
export function ProjectHandoffSection({ projectSlug, preparedBy }: Props) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="text-muted-foreground size-4" />
          Project handoff
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Generate a handoff report when this project is moving to another
          TAM. Pulls together project + partner context, Linear metadata,
          plus your locally-tracked work and critical context. Saves to{" "}
          <code className="bg-muted rounded px-1 font-mono text-[11px]">
            handoff-YYYY-MM-DD.md
          </code>{" "}
          in the project&apos;s Hive Mind folder.
        </p>
        <GenerateHandoffButton
          projectSlug={projectSlug}
          defaultPreparedBy={preparedBy}
          variant="default"
          label="Generate handoff"
        />
      </CardContent>
    </Card>
  );
}
