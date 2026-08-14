"use client";

import * as React from "react";
import type { AnalyzeCallTranscriptOutput } from "@smithers/agents";

import { AiDraftDialog } from "@/components/ai-draft-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: AnalyzeCallTranscriptOutput;
  recordingTitle: string;
  recordedAt?: string;
  /** The project's p2_url — the post the comment will attach to. */
  p2PostUrl: string;
  /**
   * Fathom call URL to optionally include in the comment. Only passed
   * when the recording came from Fathom (fathom.video URL) — Granola
   * recordings have no shareable web URL, so the row doesn't render.
   * Note: this is the /calls/ form, viewable by the user's Fathom
   * teammates; the MCP doesn't expose public /share/ tokens (probed
   * 2026-07-30 — see PLAN for the REST-API follow-up).
   */
  recordingUrl?: string;
}

interface SectionToggles {
  summary: boolean;
  action_items: boolean;
  decisions: boolean;
  key_quotes: boolean;
  recording_link: boolean;
}

/**
 * Share-to-P2 for processed call notes. Unlike "Draft P2 update"
 * (agent-rewritten prose via the context picker), this is a
 * deterministic composer: pick which analysis sections to include,
 * the markdown assembles instantly from the structured data, then the
 * standard AiDraftDialog takes over — edit freely, Copy, or Post to
 * P2 (two-step confirm). What goes to P2 can diverge from what's in
 * Smithers simply by editing before posting; the vault's saved
 * analysis is untouched either way.
 *
 * Defaults: Summary + Key decisions on (the partner-facing meat);
 * action items + quotes opt-in since they're often internal.
 */
export function ShareCallNotesDialog({
  open,
  onOpenChange,
  analysis,
  recordingTitle,
  recordedAt,
  p2PostUrl,
  recordingUrl,
}: Props) {
  const [toggles, setToggles] = React.useState<SectionToggles>({
    summary: true,
    action_items: false,
    decisions: true,
    key_quotes: false,
    recording_link: true,
  });
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [composed, setComposed] = React.useState("");

  React.useEffect(() => {
    if (open) setDraftOpen(false);
  }, [open]);

  const counts = {
    action_items: analysis.action_items.length,
    decisions: analysis.decisions.length,
    key_quotes: analysis.key_quotes.length,
  };
  const anyChecked =
    toggles.summary ||
    (toggles.action_items && counts.action_items > 0) ||
    (toggles.decisions && counts.decisions > 0) ||
    (toggles.key_quotes && counts.key_quotes > 0);

  function toggle(key: keyof SectionToggles) {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleContinue() {
    setComposed(
      composeCallNotesMarkdown(
        analysis,
        toggles,
        recordingTitle,
        recordedAt,
        recordingUrl,
      ),
    );
    onOpenChange(false);
    setDraftOpen(true);
  }

  const rows: Array<{
    key: keyof SectionToggles;
    label: string;
    detail: string;
    disabled: boolean;
  }> = [
    {
      key: "summary",
      label: "Summary",
      detail: analysis.summary ? "1 paragraph" : "(empty)",
      disabled: !analysis.summary,
    },
    {
      key: "action_items",
      label: "Action items",
      detail: `${counts.action_items} item${counts.action_items === 1 ? "" : "s"}`,
      disabled: counts.action_items === 0,
    },
    {
      key: "decisions",
      label: "Key decisions",
      detail: `${counts.decisions} decision${counts.decisions === 1 ? "" : "s"}`,
      disabled: counts.decisions === 0,
    },
    {
      key: "key_quotes",
      label: "Key quotes",
      detail: `${counts.key_quotes} quote${counts.key_quotes === 1 ? "" : "s"}`,
      disabled: counts.key_quotes === 0,
    },
    ...(recordingUrl
      ? [
          {
            key: "recording_link" as const,
            label: "Call recording link",
            detail: "Fathom (team-visible)",
            disabled: false,
          },
        ]
      : []),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share call notes to P2</DialogTitle>
            <DialogDescription>
              Pick the sections to include. You&apos;ll review and can edit
              the composed comment before anything posts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rows.map((row) => (
              <label
                key={row.key}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={toggles[row.key] && !row.disabled}
                  disabled={row.disabled}
                  onChange={() => toggle(row.key)}
                  className="accent-foreground"
                />
                <span className={row.disabled ? "text-muted-foreground" : ""}>
                  {row.label}
                </span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {row.detail}
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleContinue} disabled={!anyChecked}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AiDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        title={`Share to P2: ${recordingTitle}`}
        meta={`Comment will post to ${p2PostUrl}`}
        rationale=""
        body={composed}
        postToP2={{ p2PostUrl }}
      />
    </>
  );
}

/**
 * Deterministic markdown assembly from the structured analysis. No
 * agent involved — the sections render exactly as saved, so the P2
 * comment is a faithful excerpt of the vault's call notes unless the
 * user edits in the review dialog.
 */
function composeCallNotesMarkdown(
  analysis: AnalyzeCallTranscriptOutput,
  toggles: SectionToggles,
  title: string,
  recordedAt?: string,
  recordingUrl?: string,
): string {
  const lines: string[] = [];
  const dateLabel = recordedAt
    ? new Date(recordedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : undefined;
  lines.push(`**Call notes — ${title}${dateLabel ? ` (${dateLabel})` : ""}**`);
  lines.push("");
  if (toggles.recording_link && recordingUrl) {
    lines.push(`[Watch the call recording](${recordingUrl})`);
    lines.push("");
  }

  if (toggles.summary && analysis.summary) {
    lines.push("**Summary**");
    lines.push("");
    lines.push(analysis.summary.trim());
    lines.push("");
  }
  if (toggles.action_items && analysis.action_items.length > 0) {
    lines.push("**Action items**");
    lines.push("");
    for (const item of analysis.action_items) {
      const owner =
        item.owner && item.owner !== "unknown" ? ` _(${item.owner})_` : "";
      lines.push(`- ${item.text}${owner}`);
    }
    lines.push("");
  }
  if (toggles.decisions && analysis.decisions.length > 0) {
    lines.push("**Key decisions**");
    lines.push("");
    for (const d of analysis.decisions) {
      lines.push(`- **${d.text}**${d.context ? ` — ${d.context}` : ""}`);
    }
    lines.push("");
  }
  if (toggles.key_quotes && analysis.key_quotes.length > 0) {
    lines.push("**Key quotes**");
    lines.push("");
    for (const q of analysis.key_quotes) {
      lines.push(`> ${q.text}`);
      lines.push(`> — _${q.speaker}_`);
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}
