"use client";

import {
  Archive,
  ExternalLink,
  Loader2,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import type { Agenda, AgendaItem } from "@smithers/vault";

import {
  addAgendaItemAction,
  archiveCheckedAgendaItemsAction,
  toggleAgendaItemAction,
} from "@/app/agendas/[slug]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

interface Props {
  /** Linked agenda (when project's partner has a matching agenda file). */
  agenda: Agenda | null;
  /** The current project's display name — used to match the H3 group within Open Items. */
  projectName: string;
  /** Partner display name shown in the empty-state CTA so the user knows what to put in frontmatter. */
  partnerSlug: string | undefined;
  /** href to the standalone /agendas/<slug> editor for the linked agenda, if any. */
  editorHref: string | null;
}

const AGENDA_DOC_HINT =
  "Add `partner: <slug>` to the agenda file's frontmatter to link it to every project under that partner.";

/**
 * Compact, project-scoped view of a per-partner agenda. Shows three
 * groups in priority order: items tied to *this* project (matched by
 * H3 sub-heading), general partner-level items (no H3), and items
 * belonging to other projects under the same partner (collapsed by
 * default — useful context for the call, not the daily flow). New
 * items default to the current project's group.
 */
export function AgendaPanel({
  agenda,
  projectName,
  partnerSlug,
  editorHref,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [newItem, setNewItem] = React.useState("");
  const [items, setItems] = React.useState<AgendaItem[]>(
    agenda?.open_items ?? [],
  );
  React.useEffect(() => {
    setItems(agenda?.open_items ?? []);
  }, [agenda?.open_items]);

  // Bucket items by relation to this project. H3 match is
  // case-insensitive so Katie can write either "Phase 2" or
  // "the-pocket-nyc-phase-2" without bookkeeping.
  const normalized = projectName.trim().toLowerCase();
  const thisProjectItems: AgendaItem[] = [];
  const generalItems: AgendaItem[] = [];
  const otherProjectItems = new Map<string, AgendaItem[]>();
  for (const item of items) {
    if (!item.group) {
      generalItems.push(item);
      continue;
    }
    if (item.group.trim().toLowerCase() === normalized) {
      thisProjectItems.push(item);
      continue;
    }
    const bucket = otherProjectItems.get(item.group) ?? [];
    bucket.push(item);
    otherProjectItems.set(item.group, bucket);
  }
  const otherGroupCount = Array.from(otherProjectItems.values()).reduce(
    (acc, v) => acc + v.length,
    0,
  );
  const checkedCount = items.filter((i) => i.checked).length;

  function handleToggle(itemId: string, nextChecked: boolean) {
    if (!agenda) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, checked: nextChecked } : it,
      ),
    );
    startTransition(async () => {
      const r = await toggleAgendaItemAction(
        agenda.filename,
        itemId,
        nextChecked,
      );
      if (!r.ok) {
        toast.error(r.reason);
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId ? { ...it, checked: !nextChecked } : it,
          ),
        );
        return;
      }
      router.refresh();
    });
  }

  function handleAdd() {
    if (!agenda) return;
    const text = newItem.trim();
    if (!text) return;
    startTransition(async () => {
      const r = await addAgendaItemAction(agenda.filename, text, {
        group: projectName,
      });
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      setNewItem("");
      router.refresh();
    });
  }

  function handleArchive() {
    if (!agenda || checkedCount === 0) return;
    startTransition(async () => {
      const r = await archiveCheckedAgendaItemsAction(agenda.filename);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      toast.success(
        `Archived ${r.archived} item${r.archived === 1 ? "" : "s"}`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Agenda
          <span className="text-muted-foreground text-xs font-normal">
            {agenda ? agenda.title : "not linked"}
          </span>
          {agenda && editorHref ? (
            <Link
              href={editorHref}
              className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs font-normal"
            >
              <ExternalLink className="size-3" />
              Open full agenda
            </Link>
          ) : null}
          {agenda && checkedCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleArchive}
              disabled={pending}
              className={editorHref ? "ml-2" : "ml-auto"}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Archive className="mr-1.5 size-3.5" />
              )}
              Archive {checkedCount}
            </Button>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {!agenda ? (
          <EmptyState partnerSlug={partnerSlug} />
        ) : (
          <>
            <Group
              label="For this project"
              hint={`Items under ### ${projectName}`}
              items={thisProjectItems}
              empty="No items for this project yet. Add one below."
              onToggle={handleToggle}
              pending={pending}
            />
            {generalItems.length > 0 ? (
              <Group
                label="Partner-level"
                hint="Items not tied to a specific project"
                items={generalItems}
                empty=""
                onToggle={handleToggle}
                pending={pending}
              />
            ) : null}
            {otherGroupCount > 0 ? (
              <details className="group/other">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium uppercase tracking-wide list-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="transition-transform group-open/other:rotate-90">
                      ▸
                    </span>
                    Other projects · {otherGroupCount} item
                    {otherGroupCount === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="mt-2 space-y-3 pl-4">
                  {Array.from(otherProjectItems.entries()).map(
                    ([group, groupItems]) => (
                      <Group
                        key={group}
                        label={group}
                        hint=""
                        items={groupItems}
                        empty=""
                        onToggle={handleToggle}
                        pending={pending}
                        muted
                      />
                    ),
                  )}
                </div>
              </details>
            ) : null}

            <div className="border-border flex items-start gap-2 border-t pt-3">
              <textarea
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder={`Add an item to ### ${projectName}. Markdown supported.`}
                rows={2}
                disabled={pending}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !pending
                  ) {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={pending || !newItem.trim()}
              >
                {pending ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 size-3.5" />
                )}
                Add
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Group({
  label,
  hint,
  items,
  empty,
  onToggle,
  pending,
  muted = false,
}: {
  label: string;
  hint: string;
  items: AgendaItem[];
  empty: string;
  onToggle: (id: string, nextChecked: boolean) => void;
  pending: boolean;
  muted?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        <span>{label}</span>
        {hint ? (
          <span className="text-muted-foreground/70 font-normal normal-case">
            · {hint}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        empty ? (
          <p className="text-muted-foreground text-xs italic">{empty}</p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => onToggle(item.id, e.target.checked)}
                disabled={pending}
                className="mt-1 accent-foreground"
              />
              <div
                className={cn(
                  "flex-1 text-sm",
                  item.checked && "text-muted-foreground line-through",
                  muted && "text-muted-foreground",
                )}
              >
                <Markdown source={item.text} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ partnerSlug }: { partnerSlug: string | undefined }) {
  return (
    <div className="text-sm">
      <p className="text-muted-foreground">
        No agenda linked to this partner yet.
      </p>
      <p className="text-muted-foreground mt-1.5 text-xs">
        {AGENDA_DOC_HINT}
        {partnerSlug ? (
          <>
            {" "}
            For this project, the value would be{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
              partner: {partnerSlug}
            </code>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}
