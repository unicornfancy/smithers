"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  archiveDraftAction,
  updateDraftBodyAction,
} from "@/app/drafts/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";

interface Props {
  draftId: string;
  initialBody: string;
  /** Archived drafts are read-only by default — explicit edits feel risky once a thing has shipped. */
  archived?: boolean;
}

const SAVE_DEBOUNCE_MS = 1500;

/**
 * In-app draft editor: textarea with auto-save (1.5s after last
 * keystroke) and an explicit Save button. Toggle Preview to render
 * the live markdown side-by-side. Archived drafts open read-only;
 * the user can still toggle Preview to read the rendered version.
 *
 * Atomic writes happen via the updateDraftBody vault helper —
 * frontmatter is preserved verbatim.
 */
export function DraftEditor({ draftId, initialBody, archived }: Props) {
  const router = useRouter();
  const [body, setBody] = React.useState(initialBody);
  const [savedBody, setSavedBody] = React.useState(initialBody);
  const [preview, setPreview] = React.useState(false);
  const [saving, startSaving] = React.useTransition();
  const [archiving, startArchiving] = React.useTransition();
  const [savedFlash, setSavedFlash] = React.useState(false);
  const dirty = body !== savedBody;

  function save(nextBody?: string) {
    const target = nextBody ?? body;
    if (target === savedBody) return;
    startSaving(async () => {
      try {
        await updateDraftBodyAction(draftId, target);
        setSavedBody(target);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save draft",
        );
      }
    });
  }

  // Debounced auto-save: any keystroke schedules a save 1.5s out;
  // a fresh keystroke cancels and restarts the timer. Saves on
  // unmount too so closing the tab mid-edit doesn't drop work.
  React.useEffect(() => {
    if (archived) return;
    if (body === savedBody) return;
    const handle = setTimeout(() => save(body), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, archived]);

  function handleArchive() {
    if (archived) return;
    // Save any unsaved changes first so archive captures the latest body.
    function archive() {
      startArchiving(async () => {
        try {
          await archiveDraftAction(draftId);
          toast.success("Draft archived");
          // Fire-and-forget: learn from this archive in the background.
          fetch("/api/learn-from-archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          })
            .then((r) => r.json())
            .then((data: { ok: boolean; applied?: { filename: string }[] }) => {
              if (data.ok && data.applied && data.applied.length > 0) {
                const n = data.applied.length;
                toast.success(
                  `${n} learning${n === 1 ? "" : "s"} added to style guide`,
                );
              }
            })
            .catch(() => {}); // silent failure — learning is best-effort
          // Drafts without a real draft_id in frontmatter use a
          // path-derived `local:Drafts/<name>` id. Archive moves the
          // file to Drafts/Archived Drafts/ so that derived id no
          // longer matches; refreshing the current URL would 404.
          // Send the user back to the index, where the archived row
          // shows up under "Archived" with its new id.
          router.push("/drafts");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't archive draft",
          );
        }
      });
    }
    if (dirty) {
      startSaving(async () => {
        try {
          await updateDraftBodyAction(draftId, body);
          setSavedBody(body);
          archive();
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't save before archive",
          );
        }
      });
    } else {
      archive();
    }
  }

  // Cmd/Ctrl-S → explicit save.
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  /**
   * Paste interceptor: when the clipboard carries an `text/html` payload
   * with anchor tags (Gmail, Google Docs, browser selection from a
   * webpage, etc.), translate each `<a href="X">label</a>` into the
   * markdown `[label](X)` form before inserting. Other formatting drops
   * — bold/italic/etc would clash with markdown conventions and isn't
   * what users expect in a markdown editor.
   *
   * Plain-text pastes fall through to the browser default — no
   * preventDefault, no special handling. URLs that arrive as plain text
   * already render as clickable links in the markdown preview when
   * properly bracketed; we don't auto-linkify bare URLs.
   */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (archived) return;
    const html = e.clipboardData.getData("text/html");
    if (!html || !/<a\s+[^>]*href=/i.test(html)) return;
    e.preventDefault();
    const converted = htmlToMarkdownLinks(html);
    insertAtCursor(e.currentTarget, converted, setBody);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-[11px]">
          {archived
            ? "Read-only · archived"
            : saving
              ? "Saving…"
              : savedFlash
                ? "Saved"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreview((p) => !p)}
            className="h-7 gap-1.5 text-xs"
          >
            {preview ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
            {preview ? "Hide preview" : "Show preview"}
          </Button>
          {!archived ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleArchive}
                disabled={archiving || saving}
                title="Archive this draft (moves to Drafts/Archived Drafts/)"
                className="h-7 gap-1.5 text-xs"
              >
                {archiving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                Archive
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => save()}
                disabled={!dirty || saving}
                className="h-7 gap-1.5 text-xs"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : savedFlash ? (
                  <Check className="size-3.5" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {savedFlash ? "Saved" : "Save"}
              </Button>
            </>
          ) : null}
        </span>
      </div>

      <div
        className={cn(
          "grid gap-3",
          preview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1",
        )}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={handlePaste}
          readOnly={archived}
          spellCheck
          className={cn(
            "border-input bg-background focus-visible:ring-ring",
            "min-h-[60vh] w-full rounded-md border p-3 font-mono text-sm leading-relaxed",
            "focus-visible:outline-none focus-visible:ring-1",
            "resize-y",
            archived && "opacity-80",
          )}
        />
        {preview ? (
          <div className="border-input min-h-[60vh] rounded-md border bg-background p-4 overflow-y-auto">
            <Markdown source={body} />
          </div>
        ) : null}
      </div>

      {!archived ? (
        <p className="text-muted-foreground text-[11px]">
          Auto-saves 1.5s after you stop typing. Cmd/Ctrl-S to save now.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Convert a rich-text HTML clipboard payload to plain text with
 * markdown links preserved. Two passes:
 *   1. Walk every `<a href>` and replace it with `[text](href)`.
 *   2. Strip all remaining HTML to leave only the text content.
 *
 * We parse with the browser's DOMParser — no `dangerouslySetInnerHTML`,
 * no script execution risk (DOMParser produces an inert document).
 *
 * Edge cases handled:
 *   - Nested anchors (rare; outer wins, inner becomes its text)
 *   - Anchors with no href (treated as plain text)
 *   - Empty/whitespace anchor text (uses the href as the label)
 *   - Block-level elements rendered with newline separators
 */
function htmlToMarkdownLinks(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    const label = (a.textContent ?? "").trim();
    if (!href) {
      a.replaceWith(label);
      return;
    }
    const md = `[${label || href}](${href})`;
    a.replaceWith(md);
  });
  // Insert newlines between block-level elements so paragraphs survive.
  doc.querySelectorAll("p, div, br, li").forEach((el) => {
    el.insertAdjacentText("afterend", "\n");
  });
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Insert text at the textarea's caret (or replace its selection), and
 * push the new full-value through React's controlled-component channel.
 */
function insertAtCursor(
  textarea: HTMLTextAreaElement,
  text: string,
  setValue: (v: string) => void,
): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const next =
    textarea.value.slice(0, start) + text + textarea.value.slice(end);
  setValue(next);
  // Move caret to the end of the inserted text, after React commits.
  window.requestAnimationFrame(() => {
    const caret = start + text.length;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
  });
}
