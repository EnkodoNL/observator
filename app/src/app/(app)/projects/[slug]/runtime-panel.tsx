// SPDX-License-Identifier: FSL-1.1-ALv2
import { ShieldCheckIcon, ShieldWarningIcon, WarningIcon } from "@phosphor-icons/react/ssr";
import { CodeBlock } from "@/components/code-block";
import type { ResourceInventory } from "@/lib/coolify/inventory";
import type { RuntimeEolData, RuntimeSecurityData } from "@/lib/issues/types";
import { pbDate } from "@/lib/pb/admin";
import type { BuildRecord } from "@/lib/pb/types";
import {
  CHECKED_RUNTIMES,
  imageAction,
  lineDescription,
  pinAdvice,
  pinLine,
  runtimeLabel,
} from "@/lib/runtimes/labels";
import type { Runtime, RuntimeEvaluation } from "@/lib/runtimes/types";
import type { StatusSummary } from "@/lib/status";
import { formatDate, timeAgo } from "@/lib/time";

/** One checked runtime: version, release line, and what to do about it. */
function CheckedRuntime({
  runtime,
  evaluation,
  security,
  eol,
  versionNow,
}: {
  runtime: Runtime;
  evaluation: RuntimeEvaluation | null;
  security: RuntimeSecurityData | undefined;
  eol: RuntimeEolData | undefined;
  /** For a moving image tag: what it points to now. */
  versionNow: string | null;
}) {
  const label = runtimeLabel(runtime.name);
  const line = lineDescription(evaluation);
  const image = security?.image;
  // A Coolify image gets a new tag (or a newer release of the image); a Dockerfile gets a pin.
  const pin = image
    ? image.embedded
      ? null
      : `${image.name}:${security!.target}`
    : security
      ? pinLine(runtime.name, security.target, security.os)
      : null;
  const advice = image
    ? `${imageAction(runtime.name, security!.target, image).replace(/^./, (c) => c.toUpperCase())}.`
    : pin
      ? pinAdvice(runtime.name)
      : security
        ? `Move to ${security.target} and redeploy.`
        : "";
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-mono text-3xl tracking-tight">{runtime.version}</p>
        {line && <p className="text-sm">{line}</p>}
      </div>
      <div className="space-y-3">
        {security ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-medium text-warn">
              <ShieldWarningIcon className="size-4" />{" "}
              {security.securityReleases.length > 0 ? "Security update available" : "Newer patch available"}:{" "}
              {security.target}
            </p>
            <p className="text-sm text-muted-foreground">
              {security.securityReleases.length === 0
                ? `${security.target} is the newest patch of the ${security.line} line.`
                : security.securityReleases.length === 1
                  ? `${label} ${security.securityReleases[0]} was a security release.`
                  : `${security.securityReleases.length} security releases since ${security.running}, most recently ${security.securityReleases.at(-1)}.`}{" "}
              {advice}
            </p>
            {pin && <CodeBlock code={pin} />}
          </div>
        ) : evaluation?.versionKnown === false ? (
          <p className="text-sm text-muted-foreground">
            {evaluation.phase === "unknown"
              ? `No ${label} release line matches ${runtime.version}.`
              : `A moving tag: only the ${evaluation.line} line is known${versionNow ? `, which the tag points to as ${versionNow} now` : ""}. Pin the image to an exact version to check its patches.`}
          </p>
        ) : evaluation?.patchAvailable && evaluation.latestInLine ? (
          <p className="text-sm text-muted-foreground">
            Newer patch available:{" "}
            <span className="font-mono text-foreground">{evaluation.latestInLine}</span>. No security fixes in
            between.
          </p>
        ) : evaluation ? (
          <p className="flex items-center gap-2 font-medium text-ok">
            <ShieldCheckIcon className="size-4" /> Latest patch of this release line
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Release data is not available right now.</p>
        )}
        {eol && (
          <p className="flex items-start gap-2 text-sm text-warn">
            <WarningIcon className="mt-0.5 size-4 shrink-0" />
            {eol.phase === "eol"
              ? `${label} ${eol.line} reached end-of-life on ${formatDate(new Date(eol.end))}. Move to a supported line${evaluation?.latestSupported ? `, such as ${evaluation.latestSupported}` : ""}.`
              : `${label} ${eol.line} reaches end-of-life on ${formatDate(new Date(eol.end))}. Plan the move to a newer line.`}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The runtimes of the latest build. Checked ones (Node.js, Go, MariaDB, ...) get their release
 * line and advice; the rest is listed with its version, so it is at least visible. inventory:
 * for a Coolify database or service, what its images are, synced rather than reported.
 */
export function RuntimePanel({
  latest,
  summary,
  evaluations,
  inventory = null,
}: {
  latest: BuildRecord | null;
  summary: StatusSummary;
  evaluations: Map<string, RuntimeEvaluation>;
  inventory?: ResourceInventory | null;
}) {
  if (!latest) {
    return (
      <div className="rounded-xl border p-5 text-sm text-muted-foreground">
        {inventory
          ? "Nothing synced from Coolify yet, or none of its images could be read. The sync runs every hour."
          : "No build has reported yet. Add the snippet from the Setup tab and run a build."}
      </div>
    );
  }
  const versionNow = (name: string) =>
    inventory?.images.find((i) => i.product === name && !i.pinned)?.versionNow ?? null;
  const runtimes = latest.runtimes ?? [];
  const checked = runtimes.filter((r) => CHECKED_RUNTIMES.includes(r.name));
  const unchecked = runtimes.filter((r) => !CHECKED_RUNTIMES.includes(r.name));
  const dataFor = <T extends { runtime: string }>(issues: { data: unknown }[], name: string) =>
    issues.map((i) => i.data as T).find((d) => d.runtime === name);

  return (
    <div className="space-y-5 rounded-xl border p-5">
      {checked.map((r) => (
        <CheckedRuntime
          key={`${r.name}@${r.version}`}
          runtime={r}
          evaluation={evaluations.get(r.name) ?? null}
          security={dataFor<RuntimeSecurityData>(summary.runtimeSecurity, r.name)}
          eol={dataFor<RuntimeEolData>(summary.runtimeEol, r.name)}
          versionNow={versionNow(r.name)}
        />
      ))}
      {runtimes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {inventory
            ? "None of its images is a product or runtime Observator checks. Its images are listed on the Setup tab."
            : "The latest build found no runtime it recognizes (Node.js, Go, Bun, Deno, Python, PHP, Ruby)."}
        </p>
      )}
      {unchecked.length > 0 && (
        <ul className="space-y-1 text-sm">
          {unchecked.map((r) => (
            <li key={`${r.name}@${r.version}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-muted-foreground">{runtimeLabel(r.name)}</span>
              <span className="font-mono">{r.version}</span>
              <span className="text-xs text-muted-foreground">not checked yet</span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        {[
          latest.appVersion && `${latest.appName || "app"} ${latest.appVersion}`,
          latest.platform && `${latest.platform}/${latest.arch}`,
          latest.os,
          inventory
            ? `from Coolify, changed ${timeAgo(pbDate(latest.created))}, synced ${timeAgo(new Date(inventory.syncedAt))}`
            : `reported ${timeAgo(pbDate(latest.created))}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}
