import { ExternalLink, FileText } from "lucide-react";
import type { HiveMindBrief } from "@smithers/vault";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import {
  GenerateBriefButton,
  type TranscriptOption,
} from "@/components/generate-brief-button";
import { LinkExistingBriefButton } from "@/components/link-existing-brief-button";

interface Props {
  brief: HiveMindBrief | null;
  editPath: string | null;
  projectSlug: string;
  /** True when the project is HM-linked and brief generation is possible. */
  canGenerate: boolean;
  /** All project call transcripts available in HM. */
  transcripts: TranscriptOption[];
  initialDiscoveryDocUrl: string;
  initialRegistrar: string;
  initialDns: string;
}

export function ProjectBriefSection({
  brief,
  editPath,
  projectSlug,
  canGenerate,
  transcripts,
  initialDiscoveryDocUrl,
  initialRegistrar,
  initialDns,
}: Props) {
  if (!brief) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" />
            Project brief
            {canGenerate ? (
              <span className="ml-auto flex items-center gap-1.5">
                <GenerateBriefButton
                  projectSlug={projectSlug}
                  transcripts={transcripts}
                  initialDiscoveryDocUrl={initialDiscoveryDocUrl}
                  initialRegistrar={initialRegistrar}
                  initialDns={initialDns}
                  label="Generate brief"
                  size="sm"
                />
                <LinkExistingBriefButton
                  projectSlug={projectSlug}
                  hasExistingBrief={false}
                  size="sm"
                  variant="outline"
                />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm italic">
            {canGenerate
              ? "No project brief yet — gather inputs and Smithers will run the /create-brief skill for you."
              : "Connect this project to Hive Mind to enable brief generation."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-muted-foreground" />
          Project brief
          <div className="ml-auto flex items-center gap-3">
            {canGenerate ? (
              <>
                <GenerateBriefButton
                  projectSlug={projectSlug}
                  transcripts={transcripts}
                  initialDiscoveryDocUrl={initialDiscoveryDocUrl}
                  initialRegistrar={initialRegistrar}
                  initialDns={initialDns}
                  label="Regenerate"
                  size="sm"
                  variant="ghost"
                />
                <LinkExistingBriefButton
                  projectSlug={projectSlug}
                  hasExistingBrief={true}
                  label="Link doc"
                  size="sm"
                  variant="ghost"
                />
              </>
            ) : null}
            {brief.google_doc_url ? (
              <a
                href={brief.google_doc_url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-normal"
              >
                <ExternalLink className="size-3" />
                Open in Google Docs
              </a>
            ) : editPath ? (
              <a
                href={editPath}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-normal"
              >
                <ExternalLink className="size-3" />
                Edit brief
              </a>
            ) : null}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Markdown source={brief.body} />
      </CardContent>
    </Card>
  );
}
