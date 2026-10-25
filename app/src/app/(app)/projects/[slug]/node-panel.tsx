// SPDX-License-Identifier: FSL-1.1-ALv2
import { ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import type { NodeEolData, NodeSecurityData } from "@/lib/issues/types";
import { pinnedImage } from "@/lib/node/advice";
import { PHASE_LABEL, type NodeEvaluation } from "@/lib/node/evaluate";
import { pbDate } from "@/lib/pb/admin";
import type { BuildRecord } from "@/lib/pb/types";
import type { StatusSummary } from "@/lib/status";
import { formatDate, timeAgo } from "@/lib/time";

export function lineDescription(evaluation: NodeEvaluation | null): string | null {
  if (!evaluation || evaluation.phase === "unknown") return null;
  const name = evaluation.codename ? `${evaluation.codename} · ` : "";
  const until = evaluation.end
    ? evaluation.phase === "eol"
      ? ` since ${formatDate(new Date(evaluation.end))}`
      : ` until ${formatDate(new Date(evaluation.end))}`
    : "";
  return `Node ${evaluation.major} · ${name}${PHASE_LABEL[evaluation.phase]}${until}`;
}

export function NodePanel({
  latest,
  summary,
  evaluation,
}: {
  latest: BuildRecord | null;
  summary: StatusSummary;
  evaluation: NodeEvaluation | null;
}) {
  if (!latest) {
    return (
      <div className="rounded-xl border p-5 text-sm text-muted-foreground">
        No build has reported yet. Add the snippet from the Setup tab and run a build.
      </div>
    );
  }
  const security = summary.nodeSecurity?.data as NodeSecurityData | undefined;
  const eol = summary.nodeEol?.data as NodeEolData | undefined;
  const line = lineDescription(evaluation);

  return (
    <div className="grid gap-4 rounded-xl border p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Node.js</p>
        <p className="font-mono text-3xl tracking-tight">{latest.nodeVersion}</p>
        {line && <p className="text-sm">{line}</p>}
        <p className="text-xs text-muted-foreground">
          {[latest.platform && `${latest.platform}/${latest.arch}`, latest.os].filter(Boolean).join(" · ")} ·
          reported {timeAgo(pbDate(latest.created))}
        </p>
      </div>
      <div className="space-y-3">
        {security ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-medium text-warn">
              <ShieldAlertIcon className="size-4" /> Security update available: {security.target}
            </p>
            <p className="text-sm text-muted-foreground">
              {security.securityReleases.length === 1
                ? `Node ${security.securityReleases[0]} was a security release.`
                : `${security.securityReleases.length} security releases since ${security.running}, most recently ${security.securityReleases.at(-1)}.`}{" "}
              Pin the image and redeploy: rebuilding a floating tag like{" "}
              <code className="font-mono">node:{security.major}-alpine</code> often reuses a cached base
              image.
            </p>
            <CodeBlock code={`FROM ${pinnedImage(security.target, security.os)} AS app`} />
          </div>
        ) : evaluation?.patchAvailable && evaluation.latestInLine ? (
          <p className="text-sm text-muted-foreground">
            Newer patch available:{" "}
            <span className="font-mono text-foreground">{evaluation.latestInLine}</span>. No security fixes in
            between.
          </p>
        ) : (
          <p className="flex items-center gap-2 font-medium text-ok">
            <ShieldCheckIcon className="size-4" /> Latest patch of this release line
          </p>
        )}
        {eol && (
          <p className="flex items-start gap-2 text-sm text-warn">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {eol.phase === "eol"
              ? `Node ${eol.major} reached end-of-life on ${formatDate(new Date(eol.end))}. Move to a supported line${evaluation?.latestLts ? `, such as ${evaluation.latestLts}` : ""}.`
              : `Node ${eol.major} reaches end-of-life on ${formatDate(new Date(eol.end))}. Plan the move to a newer LTS line.`}
          </p>
        )}
      </div>
    </div>
  );
}
