import Link from "next/link";
import {
  AlertOctagon,
  Copy,
  KeyRound,
  PackageOpen,
  ShieldAlert,
  Undo2,
  UserX,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  projectSlug: string;
  runId: string;
  failureKind: string;
  errorMessage: string | null;
  /** Log tail for the collapsible details section. */
  logTail: string | null;
}

/**
 * Renders a specialized card per structured failure_kind. The point
 * of classification is that the user gets an actionable next step
 * instead of scrolling raw stderr — so every branch below either
 * points at a fix, a retry, or a "this is a Smithers bug" reporter.
 */
export function Team51FailedCard({
  projectSlug,
  runId,
  failureKind,
  errorMessage,
  logTail,
}: Props) {
  // Handle prefix-style kinds first (external-auth-failed:op etc.).
  if (failureKind.startsWith("external-auth-failed")) {
    const tool = failureKind.split(":")[1] ?? "external";
    return (
      <FrameCard
        tone="rose"
        icon={<KeyRound className="size-4 text-rose-700 dark:text-rose-300" />}
        title={`${tool} authentication failed`}
      >
        <p className="text-muted-foreground text-xs">
          {errorMessage ??
            `The team51 CLI needed \`${tool}\` and it isn't authenticated in the environment where pnpm dev is running.`}
        </p>
        <p className="text-muted-foreground text-xs">
          For 1Password (<code className="font-mono text-[11px]">op</code>)
          specifically: the session-based signin is fragile because it lives
          in the terminal that spawned pnpm dev and expires after 30 min. The
          durable fix is to turn on the 1Password 8 desktop&apos;s{" "}
          <span className="font-medium">Integrate with 1Password CLI</span>{" "}
          setting — then every `op` call triggers a biometric prompt
          regardless of which subprocess called it.
        </p>
        <LogTailDetails logTail={logTail} />
      </FrameCard>
    );
  }

  switch (failureKind) {
    case "user-cancelled":
      return (
        <FrameCard
          tone="neutral"
          icon={<Undo2 className="size-4 text-muted-foreground" />}
          title="Command aborted"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ??
              "You aborted the CLI at the confirmation step. Nothing was created."}
          </p>
          <RetryLink projectSlug={projectSlug} />
        </FrameCard>
      );

    case "duplicate-resource":
      return (
        <FrameCard
          tone="amber"
          icon={<Copy className="size-4 text-amber-700 dark:text-amber-300" />}
          title="Resource already exists"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ??
              "A resource with this name already exists on the target platform. Pick a different name."}
          </p>
          <RetryLink projectSlug={projectSlug} />
          <LogTailDetails logTail={logTail} />
        </FrameCard>
      );

    case "auth-failed":
      return (
        <FrameCard
          tone="rose"
          icon={<ShieldAlert className="size-4 text-rose-700 dark:text-rose-300" />}
          title="team51 CLI authentication error"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ??
              "The team51 CLI hit an authentication error against an Automattic API. Check `~/.team51/config.php` or your local tokens."}
          </p>
          <LogTailDetails logTail={logTail} />
        </FrameCard>
      );

    case "missing-arg":
      return (
        <FrameCard
          tone="rose"
          icon={<AlertOctagon className="size-4 text-rose-700 dark:text-rose-300" />}
          title="Smithers didn't pass a required argument"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ??
              "The CLI expected an argument Smithers didn't include. This is a Smithers gap — please report it."}
          </p>
          <p className="text-muted-foreground text-[11px]">
            Report:{" "}
            <a
              href="https://github.com/unicornfancy/smithers/issues"
              target="_blank"
              rel="noreferrer"
              className="text-sky-600 dark:text-sky-400 underline-offset-2 hover:underline"
            >
              github.com/unicornfancy/smithers/issues
            </a>
          </p>
          <LogTailDetails logTail={logTail} />
        </FrameCard>
      );

    case "timeout":
      return (
        <FrameCard
          tone="rose"
          icon={<AlertOctagon className="size-4 text-rose-700 dark:text-rose-300" />}
          title="Command timed out"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ??
              "Smithers killed the CLI after 10 minutes. A partial-success state on the remote side is possible."}
          </p>
          <LogTailDetails logTail={logTail} />
        </FrameCard>
      );

    case "unknown-command":
      return (
        <FrameCard
          tone="rose"
          icon={<PackageOpen className="size-4 text-rose-700 dark:text-rose-300" />}
          title="team51 doesn't recognize this command"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ??
              "Your local team51 CLI clone may be out of date. Run `cd ~/team51-cli && git pull && composer install`."}
          </p>
          <LogTailDetails logTail={logTail} />
        </FrameCard>
      );

    default:
      return (
        <FrameCard
          tone="rose"
          icon={<AlertOctagon className="size-4 text-rose-700 dark:text-rose-300" />}
          title="Command failed"
        >
          <p className="text-muted-foreground text-xs">
            {errorMessage ?? "Command exited non-zero. Full log below."}
          </p>
          <LogTailDetails logTail={logTail} />
        </FrameCard>
      );
  }
}

function FrameCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: "rose" | "amber" | "neutral";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const border =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
        : "";
  return (
    <Card className={border || undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

function RetryLink({ projectSlug }: { projectSlug: string }) {
  return (
    <p className="text-muted-foreground text-[11px]">
      Retry: head back to the{" "}
      <Link
        href={`/projects/${projectSlug}`}
        className="text-sky-600 dark:text-sky-400 underline-offset-2 hover:underline"
      >
        project workbench
      </Link>{" "}
      Provisioning card.
    </p>
  );
}

function LogTailDetails({ logTail }: { logTail: string | null }) {
  if (!logTail) return null;
  const tail = logTail.split("\n").slice(-30).join("\n").trim();
  if (!tail) return null;
  return (
    <details>
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
        Show log tail (last 30 lines)
      </summary>
      <pre className="bg-muted mt-2 max-h-64 overflow-auto rounded p-2 text-[11px]">
        {tail}
      </pre>
    </details>
  );
}
