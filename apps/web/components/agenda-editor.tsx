"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import type { Agenda } from "@smithers/vault";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import {
  addAgendaItemAction,
  archiveCheckedAgendaItemsAction,
  toggleAgendaItemAction,
} from "@/app/agendas/[slug]/actions";

interface Props {
  agenda: Agenda;
}

export function AgendaEditor({ agenda }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [newItem, setNewItem] = React.useState("");
  // Mirror the open_items list locally so toggles feel instant; we re-sync
  // from server on revalidation.
  const [items, setItems] = React.useState(agenda.open_items);
  React.useEffect(() => {
    setItems(agenda.open_items);
  }, [agenda.open_items]);

  const checkedCount = items.filter((i) => i.checked).length;

  function handleToggle(itemId: string, nextChecked: boolean) {
    // Optimistic update.
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
        // Roll back on failure.
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
    const text = newItem.trim();
    if (!text) return;
    startTransition(async () => {
      const r = await addAgendaItemAction(agenda.filename, text);
      if (!r.ok) {
        toast.error(r.reason);
        return;
      }
      setNewItem("");
      router.refresh();
    });
  }

  function handleArchive() {
    if (checkedCount === 0) return;
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Open items
            <span className="text-muted-foreground text-xs font-normal">
              {items.length} total
            </span>
            {checkedCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleArchive}
                disabled={pending}
                className="ml-auto"
              >
                {pending ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Archive className="mr-1.5 size-3.5" />
                )}
                Archive {checkedCount} checked
              </Button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              No open items yet — add one below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => handleToggle(item.id, e.target.checked)}
                    disabled={pending}
                    className="mt-1 accent-foreground"
                  />
                  <div
                    className={
                      item.checked
                        ? "text-muted-foreground flex-1 text-sm line-through"
                        : "flex-1 text-sm"
                    }
                  >
                    <Markdown source={item.text} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="border-border flex items-start gap-2 border-t pt-3">
            <textarea
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add an item — markdown supported (links, **bold**, etc.)"
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
        </CardContent>
      </Card>

      {agenda.archived.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agenda.archived.map((section, idx) => (
              <div key={`${section.heading}-${idx}`} className="space-y-1">
                <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  {section.heading}
                </h3>
                <div className="text-sm">
                  <Markdown source={section.body} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
