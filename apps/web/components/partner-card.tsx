import { ExternalLink } from "lucide-react";
import type { HiveMindPartner } from "@smithers/vault";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

interface Props {
  partner: HiveMindPartner | null;
  editPath: string | null;
  hmIsConfigured: boolean;
}

export function PartnerCard({ partner, editPath, hmIsConfigured }: Props) {
  if (!hmIsConfigured || !partner) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{partner.title ?? "Partner"}</span>
          {partner.nda ? (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              NDA
            </span>
          ) : null}
          {editPath ? (
            <a
              href={editPath}
              className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs font-normal"
            >
              <ExternalLink className="size-3" />
              Edit in Hive-Mind
            </a>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {partner.description ? (
          <p className="text-muted-foreground text-sm">{partner.description}</p>
        ) : null}
        {partner.owner ? (
          <p className="text-muted-foreground text-xs">Owner: {partner.owner}</p>
        ) : null}
        {(partner.tags ?? []).length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {(partner.tags ?? []).map((t) => (
              <li
                key={t}
                className={cn(
                  "bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wide",
                )}
              >
                {t}
              </li>
            ))}
          </ul>
        ) : null}
        {partner.body ? (
          <Markdown source={partner.body} />
        ) : null}
      </CardContent>
    </Card>
  );
}
