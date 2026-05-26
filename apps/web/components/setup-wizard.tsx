"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  updateApiKeyAction,
  updateIdentityAction,
  updateMcpsAction,
  updatePathsAction,
  type SetupStatus,
} from "@/app/setup/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  initialStatus: SetupStatus;
}

type PathKey = "vault" | "hive_mind" | "my_voice";
type McpKey = "context_a8c" | "hive_mind" | "fathom";
type ApiKeyName = "ANTHROPIC_API_KEY" | "LINEAR_API_KEY";

const PATH_FIELDS: { key: PathKey; label: string; hint: string }[] = [
  {
    key: "vault",
    label: "Vault",
    hint: "Where your markdown notes live (Obsidian-compatible).",
  },
  {
    key: "hive_mind",
    label: "Hive Mind",
    hint: "Your local Team51-Hive-Mind clone. Required for Hive Mind features.",
  },
  {
    key: "my_voice",
    label: "My Voice",
    hint: "Skill files (SKILL.md, PARTNER_COMMS.md). Powers /style-guide.",
  },
];

const MCP_FIELDS: { key: McpKey; label: string; hint: string }[] = [
  {
    key: "context_a8c",
    label: "ContextA8C",
    hint: "Slack, GitHub, Linear, and Zendesk activity feed.",
  },
  {
    key: "hive_mind",
    label: "Hive Mind",
    hint: "Read/sync project state from your local Hive Mind server.",
  },
  {
    key: "fathom",
    label: "Fathom",
    hint: "Pull call transcripts and recent meetings.",
  },
];

export function SetupWizard({ initialStatus }: Props) {
  const [status, setStatus] = React.useState(initialStatus);

  return (
    <div className="flex flex-col gap-6">
      <FirstRunBanner status={status} />
      <PathsSection status={status} setStatus={setStatus} />
      <IdentitySection status={status} setStatus={setStatus} />
      <ApiKeysSection status={status} setStatus={setStatus} />
      <McpsSection status={status} setStatus={setStatus} />
      <OAuthSection />
      <ReloadNotice
        configLocalPath={status.config_local.path}
        configLocalExists={status.config_local.exists}
      />
    </div>
  );
}

function FirstRunBanner({ status }: { status: SetupStatus }) {
  // Heuristic: show the banner only when config.local.yaml doesn't
  // exist yet AND essentials are missing. We don't want this nagging
  // returning users with a fully-configured setup.
  const essentialsMissing =
    !status.paths.vault.exists ||
    !status.paths.vault.is_directory ||
    !status.api_keys.anthropic.set;
  if (status.config_local.exists && !essentialsMissing) return null;

  const lines: string[] = [];
  if (!status.config_local.exists) {
    lines.push(
      "No config.local.yaml yet — saving any field below creates it. Falling back to config.example.yaml defaults until then.",
    );
  }
  if (!status.paths.vault.exists || !status.paths.vault.is_directory) {
    lines.push(
      "Set the Vault path to a directory of markdown notes. Smithers reads and writes there.",
    );
  }
  if (!status.api_keys.anthropic.set) {
    lines.push(
      "Add an ANTHROPIC_API_KEY so the AI affordances (drafts, top-3, weekly update) can run.",
    );
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-900/50 flex flex-col gap-1 rounded-md border px-4 py-3 text-sm">
      <p className="font-medium">Finish setup to use Smithers</p>
      <ul className="text-amber-800/85 dark:text-amber-100/80 list-disc space-y-0.5 pl-5 text-xs">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

// --- Sections -----------------------------------------------------------

function PathsSection({
  status,
  setStatus,
}: {
  status: SetupStatus;
  setStatus: React.Dispatch<React.SetStateAction<SetupStatus>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paths</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {PATH_FIELDS.map((f) => (
          <PathRow
            key={f.key}
            field={f}
            entry={status.paths[f.key]}
            onSaved={(value) =>
              setStatus((s) => ({
                ...s,
                paths: {
                  ...s.paths,
                  [f.key]: { ...s.paths[f.key], value },
                },
              }))
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PathRow({
  field,
  entry,
  onSaved,
}: {
  field: { key: PathKey; label: string; hint: string };
  entry: SetupStatus["paths"][PathKey];
  onSaved: (value: string) => void;
}) {
  const [value, setValue] = React.useState(entry.value);
  const [pending, setPending] = React.useState(false);
  const dirty = value !== entry.value;

  React.useEffect(() => {
    setValue(entry.value);
  }, [entry.value]);

  const configured = entry.value.trim() !== "";
  const exists = entry.exists;
  const wrongKind = exists && !entry.is_directory;

  async function handleSave() {
    setPending(true);
    try {
      const res = await updatePathsAction({ [field.key]: value });
      if (res.ok) {
        onSaved(value);
        toast.success(`${field.label} saved`);
      } else {
        toast.error(res.reason);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-foreground text-xs font-medium">
          {field.label}
          <span className="text-muted-foreground/80 ml-1.5 font-normal">
            {field.hint}
          </span>
        </label>
        <StatusBadge
          state={
            !configured
              ? "missing"
              : wrongKind
                ? "warn"
                : exists
                  ? "ok"
                  : "warn"
          }
          okLabel="Found"
          warnLabel={
            !configured
              ? "Not set"
              : wrongKind
                ? "Not a directory"
                : "Path not found"
          }
        />
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          disabled={pending}
          placeholder="~/path/to/folder"
          onChange={(e) => setValue(e.target.value)}
          className={cn(
            "border-input bg-background focus-visible:ring-ring",
            "h-8 flex-1 rounded-md border px-2.5 font-mono text-xs",
            "focus-visible:outline-none focus-visible:ring-1",
            "disabled:opacity-60",
          )}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !dirty}
          onClick={() => void handleSave()}
          className="h-8"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
      {entry.resolved && entry.resolved !== entry.value ? (
        <p className="text-muted-foreground text-[11px]">
          Resolves to{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-[10px] font-mono">
            {entry.resolved}
          </code>
        </p>
      ) : null}
    </div>
  );
}

type IdentityKey = "name" | "email" | "github_handle" | "slack_handle";

const IDENTITY_FIELDS: { key: IdentityKey; label: string; hint: string; placeholder: string }[] = [
  {
    key: "name",
    label: "Name",
    hint: "Shown in your weekly updates and authored content.",
    placeholder: "e.g. Katie McCanna",
  },
  {
    key: "email",
    label: "Email",
    hint: "Used to filter your own activity out of Pings to Action.",
    placeholder: "you@automattic.com",
  },
  {
    key: "github_handle",
    label: "GitHub handle",
    hint: "Detects your replies on GitHub issues / PRs (no @).",
    placeholder: "unicornfancy",
  },
  {
    key: "slack_handle",
    label: "Slack handle",
    hint: "Detects your replies in Slack threads (no @).",
    placeholder: "katiem",
  },
];

function IdentitySection({
  status,
  setStatus,
}: {
  status: SetupStatus;
  setStatus: React.Dispatch<React.SetStateAction<SetupStatus>>;
}) {
  const [draft, setDraft] = React.useState(status.identity);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    setDraft(status.identity);
  }, [status.identity]);

  const dirty = (Object.keys(draft) as IdentityKey[]).some(
    (k) => draft[k] !== status.identity[k],
  );

  async function handleSave() {
    setPending(true);
    try {
      const res = await updateIdentityAction(draft);
      if (res.ok) {
        setStatus((s) => ({ ...s, identity: draft }));
        toast.success("Identity saved");
      } else {
        toast.error(res.reason);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          These power the Pings to Action filters on /today — your own
          comments, replies, and authored notifications get hidden so the
          feed shows only things that need your attention.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {IDENTITY_FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label className="text-foreground text-xs font-medium">
                {field.label}
                <span className="text-muted-foreground/80 ml-1.5 font-normal">
                  {field.hint}
                </span>
              </label>
              <input
                type="text"
                value={draft[field.key]}
                placeholder={field.placeholder}
                disabled={pending}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [field.key]: e.target.value }))
                }
                className={cn(
                  "border-input bg-background focus-visible:ring-ring",
                  "h-8 rounded-md border px-2.5 text-xs",
                  "focus-visible:outline-none focus-visible:ring-1",
                  "disabled:opacity-60",
                )}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !dirty}
            onClick={() => void handleSave()}
            className="h-8"
          >
            {pending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Save identity
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeysSection({
  status,
  setStatus,
}: {
  status: SetupStatus;
  setStatus: React.Dispatch<React.SetStateAction<SetupStatus>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ApiKeyRow
          name="ANTHROPIC_API_KEY"
          label="Anthropic API key"
          hint="Required for AI drafts, agents, and analysis."
          isSet={status.api_keys.anthropic.set}
          onSaved={(set) =>
            setStatus((s) => ({
              ...s,
              api_keys: { ...s.api_keys, anthropic: { set } },
            }))
          }
        />
        <ApiKeyRow
          name="LINEAR_API_KEY"
          label="Linear API key"
          hint="Optional. Enables direct Linear writes for Hive Mind sync."
          isSet={status.api_keys.linear.set}
          onSaved={(set) =>
            setStatus((s) => ({
              ...s,
              api_keys: { ...s.api_keys, linear: { set } },
            }))
          }
        />
      </CardContent>
    </Card>
  );
}

function ApiKeyRow({
  name,
  label,
  hint,
  isSet,
  onSaved,
}: {
  name: ApiKeyName;
  label: string;
  hint: string;
  isSet: boolean;
  onSaved: (set: boolean) => void;
}) {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function handleSave() {
    setPending(true);
    try {
      const res = await updateApiKeyAction({ name, value });
      if (res.ok) {
        const trimmed = value.trim();
        onSaved(trimmed.length > 0);
        setValue("");
        toast.success(
          trimmed.length > 0 ? `${label} saved` : `${label} cleared`,
        );
      } else {
        toast.error(res.reason);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-foreground text-xs font-medium">
          {label}
          <span className="text-muted-foreground/80 ml-1.5 font-normal">
            {hint}
          </span>
        </label>
        <StatusBadge
          state={isSet ? "ok" : "warn"}
          okLabel="Set"
          warnLabel="Not set"
        />
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          disabled={pending}
          placeholder={isSet ? "•••••• (set; type to replace)" : "Paste key here"}
          onChange={(e) => setValue(e.target.value)}
          className={cn(
            "border-input bg-background focus-visible:ring-ring",
            "h-8 flex-1 rounded-md border px-2.5 font-mono text-xs",
            "focus-visible:outline-none focus-visible:ring-1",
            "disabled:opacity-60",
          )}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void handleSave()}
          className="h-8"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {value.trim() === "" ? "Clear" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function McpsSection({
  status,
  setStatus,
}: {
  status: SetupStatus;
  setStatus: React.Dispatch<React.SetStateAction<SetupStatus>>;
}) {
  const [pending, setPending] = React.useState<McpKey | null>(null);

  async function handleToggle(key: McpKey, enabled: boolean) {
    setPending(key);
    // Optimistic update.
    setStatus((s) => ({
      ...s,
      mcps: { ...s.mcps, [key]: { enabled } },
    }));
    try {
      const res = await updateMcpsAction({ [key]: enabled });
      if (!res.ok) {
        // revert
        setStatus((s) => ({
          ...s,
          mcps: { ...s.mcps, [key]: { enabled: !enabled } },
        }));
        toast.error(res.reason);
      }
    } catch (err) {
      setStatus((s) => ({
        ...s,
        mcps: { ...s.mcps, [key]: { enabled: !enabled } },
      }));
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP servers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {MCP_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={status.mcps[f.key].enabled}
                  disabled={pending === f.key}
                  onChange={(e) => void handleToggle(f.key, e.target.checked)}
                  className="size-4"
                />
                <span className="font-medium">{f.label}</span>
              </label>
              <StatusBadge
                state={status.mcps[f.key].enabled ? "ok" : "off"}
                okLabel="Enabled"
                warnLabel="Disabled"
              />
            </div>
            <p className="text-muted-foreground pl-6 text-xs">{f.hint}</p>
            {f.key === "hive_mind" ? (
              <HiveMindBuildHint
                enabled={status.mcps.hive_mind.enabled}
                built={status.hive_mind_server.built}
                hiveMindPath={status.paths.hive_mind.resolved}
              />
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function HiveMindBuildHint({
  enabled,
  built,
  hiveMindPath,
}: {
  enabled: boolean;
  built: boolean;
  hiveMindPath: string;
}) {
  if (!enabled) return null;
  if (!hiveMindPath) {
    return (
      <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mr-1 inline size-3" />
        Set the Hive Mind path above. Clone{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono">
          a8cteam51/Team51-Hive-Mind
        </code>{" "}
        first if you don&rsquo;t have it locally.
      </p>
    );
  }
  if (built) {
    return (
      <p className="pl-6 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mr-1 inline size-3" />
        Server built and ready.
      </p>
    );
  }
  return (
    <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mr-1 inline size-3" />
      Server not built. Run{" "}
      <code className="bg-muted rounded px-1 py-0.5 font-mono">
        cd {hiveMindPath}/mcp/server && npm install && npm run build
      </code>
      . Falls back to mock until built.
    </p>
  );
}

function OAuthSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>OAuth</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          The first Smithers action that hits ContextA8C or Fathom will pop a
          browser tab for OAuth. Tokens cache at{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            ~/.mcp-auth
          </code>
          . The wizard can&rsquo;t trigger this — it happens on first tool call.
        </p>
      </CardContent>
    </Card>
  );
}

function ReloadNotice({
  configLocalPath,
  configLocalExists,
}: {
  configLocalPath: string;
  configLocalExists: boolean;
}) {
  return (
    <div className="bg-muted/40 border-muted-foreground/15 rounded-md border p-3 text-xs">
      <p className="text-foreground/90">
        Saving any of these requires restarting{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono">pnpm dev</code>{" "}
        for the new config to take effect. Next.js caches config and env vars at
        module load.
      </p>
      <p className="text-muted-foreground mt-1">
        Writes go to{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono">
          {configLocalPath}
        </code>
        {configLocalExists ? null : " (will be created on first save)"} and{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono">
          apps/web/.env.local
        </code>
        .
      </p>
    </div>
  );
}

// --- Helpers ------------------------------------------------------------

function StatusBadge({
  state,
  okLabel,
  warnLabel,
}: {
  state: "ok" | "warn" | "missing" | "off";
  okLabel: string;
  warnLabel: string;
}) {
  if (state === "ok") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300/40 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        {okLabel}
      </span>
    );
  }
  if (state === "off") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium">
        {warnLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/40 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertTriangle className="size-3" />
      {warnLabel}
    </span>
  );
}
