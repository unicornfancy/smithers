import { FileText, Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  /** Version from the root package.json. */
  version: string;
  /** Anthropic model id Smithers calls — comes from config.agents.model. */
  activeModel: string;
  /** Absolute path to the repo root, used for the doc shortcut links. */
  repoRoot: string;
}

const DOC_LINKS: { filename: string; label: string; blurb: string }[] = [
  {
    filename: "README.md",
    label: "README",
    blurb: "Quick start — prereqs, install, first run.",
  },
  {
    filename: "ONBOARDING.md",
    label: "Onboarding",
    blurb: "Step-by-step walkthrough for a fresh TAM.",
  },
  {
    filename: "TROUBLESHOOTING.md",
    label: "Troubleshooting",
    blurb: "Common errors + commands when something's off.",
  },
  {
    filename: "CLAUDE.md",
    label: "CLAUDE.md",
    blurb: "Project context for the AI assistant.",
  },
];

/**
 * Identity card for the running Smithers instance — version, model,
 * and quick links to the on-disk docs. Replaces the placeholder on the
 * Settings → About tab.
 */
export function AboutCard({ version, activeModel, repoRoot }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="text-muted-foreground size-4" />
          About Smithers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Smithers</span>
          <span className="text-foreground">Launch TAM Assistant</span>

          <span className="text-muted-foreground">Version</span>
          <span className="text-foreground font-mono tabular-nums">{version}</span>

          <span className="text-muted-foreground">Active model</span>
          <span className="text-foreground font-mono">{activeModel}</span>

          <span className="text-muted-foreground">Repo</span>
          <a
            href={`file://${repoRoot}`}
            className="text-foreground hover:underline underline-offset-2 break-all font-mono text-xs"
          >
            {repoRoot}
          </a>
        </div>

        <div>
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide mb-1.5">
            Docs on disk
          </p>
          <ul className="flex flex-col divide-y">
            {DOC_LINKS.map((doc) => (
              <li
                key={doc.filename}
                className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <a
                    href={`file://${repoRoot}/${doc.filename}`}
                    className="text-foreground hover:underline underline-offset-2 inline-flex items-center gap-1.5 text-sm"
                  >
                    <FileText className="size-3.5" />
                    {doc.label}
                  </a>
                  <span className="text-muted-foreground text-xs leading-snug">
                    {doc.blurb}
                  </span>
                </div>
                <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px] shrink-0">
                  {doc.filename}
                </code>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-muted-foreground border-t pt-3 text-[11px]">
          Smithers runs locally — no remote, no telemetry. Issues and ideas
          go in{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono">
            PLAN.md
          </code>{" "}
          at the repo root; current state lives in{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono">
            STATE.md
          </code>
          .
        </p>
      </CardContent>
    </Card>
  );
}
