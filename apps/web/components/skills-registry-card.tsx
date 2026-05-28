import { Sparkles, Terminal } from "lucide-react";

import type { HiveMindSkill } from "@smithers/vault";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  skills: HiveMindSkill[];
  hiveMindPath: string | null;
}

/**
 * Lists every `<HM>/.claude/skills/<slug>/SKILL.md` skill with its
 * frontmatter metadata. Read-only for v1 — toggling skills on/off and
 * running them from the workbench come in later slices.
 */
export function SkillsRegistryCard({ skills, hiveMindPath }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="text-muted-foreground size-4" />
          Hive Mind skills
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {skills.length} registered
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hiveMindPath ? (
          <p className="text-muted-foreground text-sm">
            Hive Mind path isn&apos;t configured yet — set{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
              paths.hive_mind
            </code>{" "}
            in <a href="/settings?tab=setup" className="underline">Setup</a>{" "}
            to see your registered skills here.
          </p>
        ) : skills.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No skills found at{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-[11px]">
              {hiveMindPath}/.claude/skills/
            </code>
            . Drop SKILL.md files there to register them.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {skills.map((skill) => (
              <SkillRow key={skill.slug} skill={skill} />
            ))}
          </ul>
        )}

        <p className="text-muted-foreground border-t pt-3 text-[11px]">
          Skills run via the{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono">
            /&lt;slug&gt;
          </code>{" "}
          slash-command in a Claude Code session pointed at the Hive Mind
          clone. Smithers reads the registry; invocation still happens in
          Claude Code (see PLAN.md for the integration roadmap).
        </p>
      </CardContent>
    </Card>
  );
}

function SkillRow({ skill }: { skill: HiveMindSkill }) {
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2">
        <code className="bg-muted text-foreground rounded px-1.5 py-0.5 text-xs font-medium">
          /{skill.slug}
        </code>
        {skill.user_invocable ? null : (
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
            internal
          </span>
        )}
      </div>
      {skill.description ? (
        <p className="text-foreground text-sm leading-snug">{skill.description}</p>
      ) : null}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1">
          <Terminal className="size-3" />
          {skill.allowed_tools.length > 0
            ? skill.allowed_tools.join(", ")
            : "no tools declared"}
        </span>
        <a
          href={`file://${skill.source_path}`}
          className="hover:text-foreground underline-offset-2 hover:underline"
        >
          SKILL.md
        </a>
      </div>
    </li>
  );
}
