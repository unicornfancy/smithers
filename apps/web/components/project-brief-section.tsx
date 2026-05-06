import { ExternalLink, FileText } from "lucide-react";
import type { HiveMindBrief } from "@smithers/vault";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

interface Props {
  brief: HiveMindBrief | null;
  editPath: string | null;
}

export function ProjectBriefSection({ brief, editPath }: Props) {
  if (!brief) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-muted-foreground" />
            Project brief
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm italic">
            No project brief yet — generate one with{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
              /create-brief
            </code>{" "}
            in Hive-Mind.
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
          {brief.google_doc_url ? (
            <a
              href={brief.google_doc_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs font-normal"
            >
              <ExternalLink className="size-3" />
              Open in Google Docs
            </a>
          ) : editPath ? (
            <a
              href={editPath}
              className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs font-normal"
            >
              <ExternalLink className="size-3" />
              Edit brief
            </a>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Markdown source={brief.body} />
      </CardContent>
    </Card>
  );
}
