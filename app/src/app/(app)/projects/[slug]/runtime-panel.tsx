// SPDX-License-Identifier: FSL-1.1-ALv2
import { ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import type { RuntimeEolData, RuntimeSecurityData } from "@/lib/issues/types";
import { pbDate } from "@/lib/pb/admin";
import type { BuildRecord } from "@/lib/pb/types";
import { CHECKED_RUNTIMES, lineDescription, pinFor, runtimeLabel } from "@/lib/runtimes/labels";
import type { Runtime, RuntimeEvaluation } from "@/lib/runtimes/types";
import type { StatusSummary } from "@/lib/status";
import { formatDate, timeAgo } from "@/lib/time";

/** One checked runtime: version, release line, and what to do about it. */
function CheckedRuntime({
  runtime,
  evaluation,
  security,
  eol,
}: {
  runtime: Runtime;
  evaluation: RuntimeEvaluation | null;
  security: RuntimeSecurityData | undefined;
  eol: RuntimeEolData | undefined;
}) {
  const label = runtimeLabel(runtime.name);
  const line = lineDescription(evaluation);
  const pin = security ? pinFor(runtime.name, security.target, security.os) : null;
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
              <ShieldAlertIcon className="size-4" /> Security update available: {security.target}
            </p>
            <p className="text-sm text-muted-foreground">
              {security.securityReleases.length === 1
                ? `${label} ${security.securityReleases[0]} was a security release.`
                : `${security.securityReleases.length} security releases since ${security.running}, most recently ${security.securityReleases.at(-1)}.`}{" "}
              {pin
                ? "Pin the image and redeploy: rebuilding a floating tag often reuses a cached base image."
                : `Move to ${security.target} and redeploy.`}
            </p>
            {pin && <CodeBlock code={`FROM ${pin} AS app`} />}
          </div>
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
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
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
 * The runtimes of the latest build. Checked ones (Node.js so far) get their release line and
 * advice; the rest is listed with its version, so it is at least visible.
 */
export function RuntimePanel({
  latest,
  summary,
  evaluations,
}: {
  latest: BuildRecord | null;
  summary: StatusSummary;
  evaluations: Map<string, RuntimeEvaluation>;
}) {
  if (!latest) {
    return (
      <div className="rounded-xl border p-5 text-sm text-muted-foreground">
        No build has reported yet. Add the snippet from the Setup tab and run a build.
      </div>
    );
  }
  const runtimes = latest.runtimes ?? [];
  const checked = runtimes.filter((r) => CHECKED_RUNTIMES.includes(r.name));
  const unchecked = runtimes.filter((r) => !CHECKED_RUNTIMES.includes(r.name));
  const dataFor = <T extends { runtime: string }>(issues: { data: unknown }[], name: string) =>
    issues.map((i) => i.data as T).find((d) => d.runtime === name);

  return (
    <div className="space-y-5 rounded-xl border p-5">
      {checked.map((r) => (
        <CheckedRuntime
          key={r.name}
          runtime={r}
          evaluation={evaluations.get(r.name) ?? null}
          security={dataFor<RuntimeSecurityData>(summary.runtimeSecurity, r.name)}
          eol={dataFor<RuntimeEolData>(summary.runtimeEol, r.name)}
        />
      ))}
      {runtimes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          The latest build found no runtime it recognizes (Node.js, Bun, Deno, Python, PHP, Ruby).
        </p>
      )}
      {unchecked.length > 0 && (
        <ul className="space-y-1 text-sm">
          {unchecked.map((r) => (
            <li key={r.name} className="flex flex-wrap items-baseline gap-x-2">
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
        ]
          .filter(Boolean)
          .join(" · ")}{" "}
        · reported {timeAgo(pbDate(latest.created))}
      </p>
    </div>
  );
}
