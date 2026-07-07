"use client";

import * as React from "react";
import { CheckCircle2, GitBranch, GitMerge, Loader2, Tag } from "lucide-react";
import { toast } from "sonner";

import { updateKoshChannelAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Channel = "stable" | "trunk" | "pinned";

type StatusResponse =
  | {
      ok: true;
      branch: string;
      head: string;
      head_sha: string;
      current_tag: string | null;
      latest_tag: string | null;
      available_tags: string[];
      channel: Channel;
      pinned_tag: string;
    }
  | { ok: false; reason: string; message?: string };

type UpdateResponse =
  | {
      ok: true;
      changed: boolean;
      channel: Channel;
      target_kind: "branch" | "tag" | null;
      target_name: string | null;
      head_sha: string | null;
      summary: string;
    }
  | { ok: false; reason: string; message: string };

const inputClass =
  "border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-60";

/**
 * Diagnostics card for the Kosh clone. Shows current channel + version,
 * lets the user switch channels (stable / trunk / pinned), and syncs
 * the clone to the resolved target.
 *
 * `stable` is the safe default: it tracks the latest `vX.Y.Z` git tag,
 * so a mid-day Kosh churn can't silently break Smithers integration.
 * `trunk` is bleeding-edge for Kosh developers. `pinned` is for freezing
 * against a specific tag until the user is ready to move.
 */
export function UpdateKoshCard() {
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [channel, setChannel] = React.useState<Channel>("stable");
  const [pinnedTag, setPinnedTag] = React.useState("");
  const [savingChannel, setSavingChannel] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [lastSync, setLastSync] = React.useState<UpdateResponse | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/dev/kosh-update", { cache: "no-store" });
      const body = (await res.json()) as StatusResponse;
      setStatus(body);
      if (body.ok) {
        setChannel(body.channel);
        setPinnedTag(body.pinned_tag || body.current_tag || body.latest_tag || "");
      }
    } catch {
      /* swallow — retry on next mount / action */
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function saveChannel(next: Channel, tag?: string) {
    setSavingChannel(true);
    try {
      const r = await updateKoshChannelAction({
        channel: next,
        pinned_tag: tag,
      });
      if (r.ok) {
        toast.success(`Channel set to ${next}${tag ? ` (${tag})` : ""}`);
        setChannel(next);
        // Immediately sync so the current channel + on-disk HEAD match.
        await sync();
      } else {
        toast.error(r.reason);
      }
    } finally {
      setSavingChannel(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setLastSync(null);
    try {
      const res = await fetch("/api/dev/kosh-update", { method: "POST" });
      const body = (await res.json()) as UpdateResponse;
      setLastSync(body);
      if (body.ok) {
        if (body.changed) {
          toast.success(body.summary);
        } else {
          toast.info(body.summary);
        }
        await load();
      } else {
        toast.error(body.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      toast.error(message);
      setLastSync({ ok: false, reason: "fetch-failed", message });
    } finally {
      setSyncing(false);
    }
  }

  const notConfigured =
    status?.ok === false && status.reason === "no-kosh-path";
  const currentLabel = status?.ok
    ? status.current_tag
      ? `${status.current_tag} (${status.head_sha})`
      : `${status.branch} @ ${status.head_sha}`
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="size-4" />
          Update Kosh
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Keeps the local Kosh clone in sync with upstream. Pick a channel
          based on how much stability you need — <code>stable</code> tracks
          the latest git tag (recommended for anyone whose Smithers workflow
          depends on Kosh not moving under them). Auto-syncs before every QA
          run.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notConfigured ? (
          <p className="text-muted-foreground text-xs">
            Not configured — set{" "}
            <code className="font-mono">paths.kosh</code> in
            <code className="font-mono"> config.local.yaml</code> to enable.
          </p>
        ) : currentLabel ? (
          <p className="text-muted-foreground text-xs">
            Current:{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
              {currentLabel}
            </code>
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Reading current Kosh state&hellip;
          </p>
        )}

        {!notConfigured && status?.ok ? (
          <div className="flex flex-col gap-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Channel
            </label>
            <div className="flex flex-wrap gap-2">
              <ChannelButton
                current={channel}
                value="stable"
                icon={<Tag className="size-3.5" />}
                label={`Stable${status.latest_tag ? ` (${status.latest_tag})` : ""}`}
                onClick={() => saveChannel("stable")}
                disabled={savingChannel || syncing}
              />
              <ChannelButton
                current={channel}
                value="trunk"
                icon={<GitBranch className="size-3.5" />}
                label="Trunk (bleeding edge)"
                onClick={() => saveChannel("trunk")}
                disabled={savingChannel || syncing}
              />
              <ChannelButton
                current={channel}
                value="pinned"
                icon={<Tag className="size-3.5" />}
                label="Pinned to tag"
                onClick={() => setChannel("pinned")}
                disabled={savingChannel || syncing}
              />
            </div>

            {channel === "pinned" ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-dashed p-3">
                <label
                  htmlFor="kosh-pin-tag"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Pin to which tag?
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="kosh-pin-tag"
                    className={cn(inputClass, "w-44")}
                    value={pinnedTag}
                    onChange={(e) => setPinnedTag(e.target.value)}
                    disabled={savingChannel || syncing}
                  >
                    <option value="">(pick a tag)</option>
                    {status.available_tags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => saveChannel("pinned", pinnedTag)}
                    disabled={
                      savingChannel || syncing || !pinnedTag || pinnedTag === status.pinned_tag
                    }
                  >
                    {savingChannel ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Pin
                  </Button>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Locks Kosh at this tag; auto-updates skip until you switch
                  channels or pick a newer tag.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {!notConfigured ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={sync}
            disabled={syncing || savingChannel}
            className="w-fit gap-1.5"
          >
            {syncing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitMerge className="size-3.5" />
            )}
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        ) : null}

        {lastSync?.ok && lastSync.changed ? (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900/50 flex items-start gap-2 rounded-md border p-3 text-xs">
            <CheckCircle2 className="size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{lastSync.summary}</p>
              <p>New Kosh logic takes effect on the next QA run.</p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChannelButton({
  current,
  value,
  icon,
  label,
  onClick,
  disabled,
}: {
  current: Channel;
  value: Channel;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
        active
          ? "border-emerald-500/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "bg-background hover:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
