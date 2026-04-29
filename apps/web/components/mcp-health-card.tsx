import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleAlert,
} from "lucide-react";

import type { SourceHealth } from "@smithers/mcp-client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMcpClient } from "@/lib/server/mcp";

/**
 * MCP Health — a snapshot of every source the MCP client has touched
 * this Next.js process. Pulls directly from the in-memory health
 * registry, so it reflects what `getMcpClient().health()` saw on the
 * last fetch attempt.
 *
 * No persistence yet — restarting the dev server clears the table.
 * The original plan's "7-day error log" lands when the SQLite L2
 * cache gets wired alongside this surface.
 */
export async function McpHealthCard() {
  const mcp = await getMcpClient();
  const rows = mcp.health();
  const issues = mcp.hasIssues();
  const isMock = mcp.config.mock;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="text-muted-foreground size-4" />
          MCP health
          <span className="text-muted-foreground text-xs font-normal">
            · {rows.length}
          </span>
          {issues ? (
            <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" />
          ) : null}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Per-source state from the in-memory health registry. Surface
          state resets when the dev server restarts.{" "}
          {isMock ? (
            <span className="font-medium">
              Mock mode — set{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono">
                mcps.context_a8c.enabled: true
              </code>{" "}
              in config to wire the real ContextA8C MCP.
            </span>
          ) : null}
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No MCP calls have been made yet this session. Visit /today or a
            project workbench to populate the table.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-[11px] uppercase tracking-wide">
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Last success</th>
                  <th className="py-2 pr-4 font-medium">Last attempt</th>
                  <th className="py-2 pr-4 font-medium">Failures</th>
                  <th className="py-2 font-medium">Last error</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort((a, b) => a.source.localeCompare(b.source))
                  .map((row) => (
                    <McpHealthRow key={row.source} row={row} />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function McpHealthRow({ row }: { row: SourceHealth }) {
  return (
    <tr className="hover:bg-muted/40 border-b last:border-0">
      <td className="py-2 pr-4 align-top">
        <code className="text-foreground font-mono text-xs">
          {row.source}
        </code>
      </td>
      <td className="py-2 pr-4 align-top">
        <StatusChip status={row.status} />
      </td>
      <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums text-xs">
        {row.last_success_at ? formatTimestamp(row.last_success_at) : "—"}
      </td>
      <td className="text-muted-foreground py-2 pr-4 align-top tabular-nums text-xs">
        {row.last_attempt_at ? formatTimestamp(row.last_attempt_at) : "—"}
      </td>
      <td className="py-2 pr-4 align-top tabular-nums text-xs">
        {row.consecutive_failures > 0 ? (
          <span className="text-amber-700 dark:text-amber-400 font-medium">
            {row.consecutive_failures}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>
      <td className="text-muted-foreground py-2 align-top text-xs">
        {row.last_error ? (
          <code className="font-mono text-[11px] break-all">
            {truncate(row.last_error, 120)}
          </code>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function StatusChip({ status }: { status: SourceHealth["status"] }) {
  switch (status) {
    case "ok":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          <CheckCircle2 className="size-3" />
          ok
        </span>
      );
    case "degraded":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          <CircleAlert className="size-3" />
          degraded
        </span>
      );
    case "down":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
          <AlertCircle className="size-3" />
          down
        </span>
      );
    case "unknown":
      return (
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium">
          <Circle className="size-3" />
          unknown
        </span>
      );
  }
}

function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
