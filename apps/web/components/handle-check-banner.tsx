"use client";

import * as React from "react";
import { AlertCircle, AtSign, Check, HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HandleMapPerson {
  name: string;
  wp_username: string;
  group_slug: string;
}

interface MatticspaceHandleMap {
  known_wp_usernames: string[];
  by_candidate: Record<string, HandleMapPerson[]>;
}

interface SuggestionRow {
  /** Exact handle as typed in the draft (without the leading @). */
  typed: string;
  /** Single suggested replacement (when the match is unambiguous). */
  suggested?: HandleMapPerson;
  /** When multiple matches exist, the full set — shown without an Apply. */
  candidates?: HandleMapPerson[];
}

interface UnknownRow {
  typed: string;
}

interface Props {
  /** Current draft text. */
  text: string;
  /** Called when the user clicks Apply on a suggestion. */
  onApply: (next: string) => void;
  /** Optional label to anchor the banner ("Handle check" by default). */
  label?: string;
  /** When true, hides the banner entirely if there's nothing to flag. */
  hideWhenEmpty?: boolean;
}

const HANDLE_REGEX = /(^|[^a-zA-Z0-9_.-])@([a-zA-Z0-9_.-]+)/g;

export function HandleCheckBanner({
  text,
  onApply,
  label = "Handle check",
  hideWhenEmpty = true,
}: Props) {
  const [map, setMap] = React.useState<MatticspaceHandleMap | null>(null);
  const [mapError, setMapError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/handle-map");
        const body = (await res.json()) as MatticspaceHandleMap & { error?: string };
        if (cancelled) return;
        if (body.error) {
          setMapError(body.error);
          setMap(null);
          return;
        }
        setMap({
          known_wp_usernames: body.known_wp_usernames ?? [],
          by_candidate: body.by_candidate ?? {},
        });
      } catch (err) {
        if (cancelled) return;
        setMapError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { suggestions, unknowns } = React.useMemo(() => {
    if (!map) return { suggestions: [], unknowns: [] };
    return classifyMentions(text, map);
  }, [text, map]);

  function applySuggestion(typed: string, suggested: HandleMapPerson) {
    const next = text.replace(
      new RegExp(`(^|[^a-zA-Z0-9_.-])@${escapeRegex(typed)}\\b`, "g"),
      (_, prefix) => `${prefix}@${suggested.wp_username}`,
    );
    if (next !== text) onApply(next);
  }

  if (mapError) {
    // Silent if roster can't be loaded — don't block the user.
    return null;
  }

  const empty = suggestions.length === 0 && unknowns.length === 0;
  if (hideWhenEmpty && empty) return null;

  return (
    <div
      className={cn(
        "rounded-md border bg-card text-card-foreground p-3 text-xs space-y-2",
        suggestions.length > 0 ? "border-amber-500/40" : "border-input",
      )}
    >
      <div className="flex items-center gap-1.5 text-foreground font-medium">
        <AtSign className="size-3.5" />
        {label}
      </div>

      {suggestions.length === 0 && unknowns.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5">
          <Check className="size-3" /> Every @-mention matches a Team 51 handle.
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {suggestions.map((s, i) => (
            <SuggestionItem key={`${s.typed}-${i}`} row={s} onApply={applySuggestion} />
          ))}
        </ul>
      ) : null}

      {unknowns.length > 0 ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground inline-flex items-center gap-1">
            <HelpCircle className="size-3" />
            {unknowns.length} unknown @-mention{unknowns.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 ml-4 list-disc">
            {unknowns.map((u) => (
              <li key={u.typed} className="text-[11px]">
                <code className="bg-muted rounded px-1">@{u.typed}</code> — no
                match in Team 51 roster (could be a partner contact or a typo)
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SuggestionItem({
  row,
  onApply,
}: {
  row: SuggestionRow;
  onApply: (typed: string, suggested: HandleMapPerson) => void;
}) {
  if (row.suggested) {
    return (
      <li className="flex items-center justify-between gap-2">
        <span>
          <code className="bg-muted rounded px-1">@{row.typed}</code>{" "}
          <span className="text-muted-foreground">→</span>{" "}
          <code className="bg-emerald-500/10 text-emerald-700 rounded px-1 dark:text-emerald-400">
            @{row.suggested.wp_username}
          </code>{" "}
          <span className="text-muted-foreground">({row.suggested.name})</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onApply(row.typed, row.suggested!)}
          className="h-6 text-[11px]"
        >
          Apply
        </Button>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2">
      <AlertCircle className="text-amber-600 mt-0.5 size-3 shrink-0" />
      <span>
        <code className="bg-muted rounded px-1">@{row.typed}</code> matches
        multiple people:{" "}
        {row.candidates!.map((c, i) => (
          <span key={c.wp_username}>
            {i > 0 ? ", " : ""}
            <code className="bg-muted rounded px-1">@{c.wp_username}</code> (
            {c.name})
          </span>
        ))}{" "}
        — choose manually.
      </span>
    </li>
  );
}

function classifyMentions(
  text: string,
  map: MatticspaceHandleMap,
): { suggestions: SuggestionRow[]; unknowns: UnknownRow[] } {
  const knownSet = new Set(
    map.known_wp_usernames.map((u) => u.toLowerCase()),
  );
  const seen = new Set<string>();
  const suggestions: SuggestionRow[] = [];
  const unknowns: UnknownRow[] = [];

  HANDLE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HANDLE_REGEX.exec(text)) !== null) {
    const typed = match[2]!;
    const key = typed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (knownSet.has(key)) {
      // Already a known wp_username — perfect.
      continue;
    }

    // Try candidate lookups: lowercase exact, then with dashes/dots stripped.
    const normalized = key.replace(/[._-]+/g, "");
    const candidates =
      map.by_candidate[key] ?? map.by_candidate[normalized] ?? [];

    if (candidates.length === 0) {
      unknowns.push({ typed });
      continue;
    }
    if (candidates.length === 1) {
      suggestions.push({ typed, suggested: candidates[0] });
      continue;
    }
    suggestions.push({ typed, candidates });
  }

  return { suggestions, unknowns };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
