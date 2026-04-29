import { Activity } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UndoActionButton } from "@/components/undo-action-button";
import {
  listAllActions,
  type UserActionRow,
} from "@/lib/server/user-actions";

/**
 * Activity Log — the audit + recovery surface for everything Smithers
 * has been told to do. Reads user_actions newest-first and renders an
 * Undo button per row that reverses the action and refreshes the
 * source surfaces.
 *
 * Server component. The Undo button is the only interactive element
 * and it's a thin client wrapper around a server action.
 */
export async function ActivityLogCard() {
  const rows = await listAllActions();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="text-muted-foreground size-4" />
          Activity log
          <span className="text-muted-foreground text-xs font-normal">
            · {rows.length}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Every dismiss / pin / demote / accept Smithers has recorded.
          Undoing here restores the entity on its source surface (Today,
          project workbench, follow-ups).
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            Nothing recorded yet. Take an action on Today (dismiss a
            ping, pin a candidate, accept a stall) and it lands here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-[11px] uppercase tracking-wide">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Entity</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ActivityRow key={rowKey(r)} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ row }: { row: UserActionRow }) {
  return (
    <tr className="hover:bg-muted/40 border-b last:border-0">
      <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums text-xs">
        {formatTimestamp(row.created_at)}
      </td>
      <td className="py-2 pr-4 align-top">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${actionToneClasses(row.action)}`}
        >
          {row.action}
        </span>
      </td>
      <td className="py-2 pr-4 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-[11px] uppercase tracking-wide">
            {entityTypeLabel(row.entity_type)}
          </span>
          <code className="text-foreground break-all font-mono text-xs">
            {row.entity_id}
          </code>
        </div>
      </td>
      <td className="text-muted-foreground py-2 pr-4 align-top text-xs italic">
        {row.reason ?? "—"}
      </td>
      <td className="py-2 align-top">
        <UndoActionButton
          entityType={row.entity_type}
          entityId={row.entity_id}
          action={row.action}
        />
      </td>
    </tr>
  );
}

function rowKey(row: UserActionRow): string {
  return `${row.entity_type}:${row.entity_id}:${row.action}`;
}

function entityTypeLabel(entityType: UserActionRow["entity_type"]): string {
  switch (entityType) {
    case "ping":
      return "Ping";
    case "stall":
      return "Stall";
    case "top3_candidate":
      return "Top 3 candidate";
    case "follow_up":
      return "Follow-up";
  }
}

function actionToneClasses(action: UserActionRow["action"]): string {
  switch (action) {
    case "pin":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "demote":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    case "dismiss":
      return "bg-muted text-muted-foreground";
    case "accept":
      return "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400";
  }
}

function formatTimestamp(iso: string): string {
  // SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC;
  // normalize to a Date so we can format relative.
  const ts = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(ts)) return iso;
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
