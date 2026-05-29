"use client";

import { Loader2, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { savePartnerKnowledgeAction } from "@/app/partner-knowledge/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

interface Props {
  partnerSlug: string;
  initialBody: string;
  initialFrontmatter: Record<string, unknown>;
  /** True when the file didn't exist yet — first-save creates it. */
  isNewFile: boolean;
}

/**
 * Two-pane editor for `knowledge/partners/<slug>/partner-knowledge.md`.
 * Body is a textarea + preview toggle, mirroring the weekly-update +
 * draft editors. Save round-trips through HM MCP — preserves any
 * frontmatter fields the user didn't touch and stamps `updated` to
 * today, matching what the /update-knowledge skill would do.
 *
 * v1 deliberately scopes to body-only edits. Structured frontmatter
 * fields (title / description / team) stay editable via the existing
 * project-metadata modal + brief wizard inputs; a future slice could
 * surface a dedicated frontmatter form here.
 */
export function PartnerKnowledgeEditor({
  partnerSlug,
  initialBody,
  initialFrontmatter,
  isNewFile,
}: Props) {
  const [body, setBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);

  const dirty = body !== initialBody;
  const frontmatterEntries = Object.entries(initialFrontmatter);

  async function handleSave() {
    if (!body.trim()) {
      toast.error("Body can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await savePartnerKnowledgeAction({
        partnerSlug,
        body,
      });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(`Saved to ${res.relative_path}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {isNewFile ? (
        <Card className="border-amber-200 dark:border-amber-900/50">
          <CardContent className="py-3 text-sm">
            <p>
              No <code className="bg-muted rounded px-1 font-mono">partner-knowledge.md</code>{" "}
              found for <code className="bg-muted rounded px-1 font-mono">{partnerSlug}</code>.
              Saving will create it.
            </p>
          </CardContent>
        </Card>
      ) : frontmatterEntries.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Frontmatter (read-only)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-muted-foreground mb-1.5 text-[11px]">
              Preserved across save except <code className="font-mono">updated</code>,
              which gets stamped to today.
            </p>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
              {frontmatterEntries.map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt className="text-muted-foreground font-mono">{key}</dt>
                  <dd className="text-foreground break-all">
                    {formatFrontmatterValue(value)}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            Body
            <span className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview((p) => !p)}
              >
                {showPreview ? "Edit" : "Preview"}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {showPreview ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Markdown source={body} />
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={32}
              className="border-input bg-background focus-visible:ring-ring w-full resize-y rounded-md border p-3 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-1"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return JSON.stringify(value);
}
