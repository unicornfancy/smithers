"use client";

import { Loader2, RotateCcw, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { updateAnalyzeCallTranscriptPromptAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  /** Current value of `agents.analyze_call_transcript_prompt` from config (empty if unset). */
  initialPrompt: string;
  /** The bundled default prompt, exported from @smithers/agents for visibility + reset. */
  defaultPrompt: string;
}

export function CallTranscriptPromptCard({ initialPrompt, defaultPrompt }: Props) {
  const [prompt, setPrompt] = React.useState(initialPrompt);
  const [saving, setSaving] = React.useState(false);
  const [showDefault, setShowDefault] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateAnalyzeCallTranscriptPromptAction(prompt);
      if (result.ok) {
        toast.success(
          prompt.trim()
            ? "Saved custom prompt"
            : "Cleared override — using bundled default",
        );
      } else {
        toast.error(result.reason);
      }
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    setPrompt(defaultPrompt);
  }

  function clearOverride() {
    setPrompt("");
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Call transcript prompt</CardTitle>
        <p className="text-muted-foreground text-xs">
          Global system prompt for the analyze-call-transcript agent
          (Process Call). Leave blank to use the bundled default. The
          per-run &ldquo;Additional instructions&rdquo; field in the
          Process Call dialog still layers on top.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={resetToDefault}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="size-3" />
            Load bundled default
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearOverride}
            disabled={!prompt}
            className="text-muted-foreground text-xs"
          >
            Clear (use bundled)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDefault((v) => !v)}
            className="text-muted-foreground text-xs"
          >
            {showDefault ? "Hide" : "Show"} bundled default
          </Button>
        </div>

        {showDefault ? (
          <pre className="bg-muted/40 max-h-56 overflow-auto rounded-md border p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
            {defaultPrompt}
          </pre>
        ) : null}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="(Empty = use bundled default. Or paste your own full system prompt.)"
          rows={14}
          className="border-input focus-visible:ring-ring w-full resize-y rounded-md border bg-transparent p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1"
        />

        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-[11px]">
            Saves to{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono">
              agents.analyze_call_transcript_prompt
            </code>{" "}
            in config.local.yaml.
          </p>
          <Button
            onClick={handleSave}
            disabled={saving || prompt === initialPrompt}
            className="gap-1.5"
            size="sm"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save prompt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
