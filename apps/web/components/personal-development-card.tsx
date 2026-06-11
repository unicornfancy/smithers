"use client";

import * as React from "react";
import { Loader2, Save, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { savePersonalDevelopmentAction } from "@/app/digest/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

interface Props {
  initialBody: string;
  relativePath?: string;
  modifiedAt: string | null;
}

/**
 * Two-pane editor for the personal-development tracker. Same shape as
 * the partner-knowledge / style-guide editors: textarea + preview toggle,
 * single save button. The file is treated as a single living document —
 * no per-week scoping or AI generation, just a place to keep goals /
 * things-being-learned / things-to-revisit visible.
 */
export function PersonalDevelopmentCard({
  initialBody,
  relativePath,
  modifiedAt,
}: Props) {
  const [body, setBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const dirty = body !== initialBody;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await savePersonalDevelopmentAction(body);
      if (res.ok) {
        toast.success(res.changed ? "Saved" : "No changes");
      } else {
        toast.error(res.reason);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" />
          Personal development
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            {modifiedAt ? `last saved ${modifiedAt.slice(0, 10)}` : "new file"}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Running surface for goals, skills you&apos;re learning, and things
          worth revisiting. Saves to{" "}
          <code className="bg-muted rounded px-1 font-mono text-[11px]">
            {relativePath ?? "Personal Digest/Development.md"}
          </code>
          . Never auto-modified by Smithers.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {showPreview ? (
          <div className="rounded-md border bg-background p-3 min-h-[200px]">
            <Markdown source={body} />
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            disabled={saving}
            className={cn(
              "border-input bg-background focus-visible:ring-ring",
              "w-full resize-y rounded-md border p-3 font-mono text-sm leading-relaxed",
              "focus-visible:outline-none focus-visible:ring-1",
            )}
          />
        )}
        <div className="flex items-center gap-2">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((p) => !p)}
          >
            {showPreview ? "Edit" : "Preview"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
