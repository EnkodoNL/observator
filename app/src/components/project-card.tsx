// SPDX-License-Identifier: FSL-1.1-ALv2
import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { SeverityBadge, StatusBadge } from "@/components/status";
import type { ProjectSummary } from "@/lib/data/views";
import type { Severity } from "@/lib/pb/types";
import { daysSince, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

const ORDER: Severity[] = ["critical", "high", "moderate", "low", "unknown"];

export function ProjectCard({ item, staleDays }: { item: ProjectSummary; staleDays: number }) {
  const { project, latest, summary, lastBuildAt } = item;
  const age = daysSince(lastBuildAt);
  const stale = summary.stale || (age !== null && age >= staleDays);
  const target = (summary.nodeSecurity?.data as { target?: string } | null)?.target;

  return (
    <Link
      href={`/projects/${project.slug}`}
      className={cn(
        "group flex flex-col gap-4 rounded-xl border bg-card p-4 transition-colors outline-none hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50",
        stale && "opacity-70 hover:opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{project.name}</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">{project.slug}</p>
        </div>
        <StatusBadge status={summary.status} />
      </div>

      {latest ? (
        <div className="space-y-1">
          <p className="font-mono text-2xl tracking-tight">
            <span className="text-muted-foreground">node </span>
            {latest.nodeVersion}
          </p>
          <p className="text-xs text-muted-foreground">
            {[
              latest.platform && `${latest.platform}/${latest.arch}`,
              latest.os,
              latest.lockfileType !== "none" && latest.lockfileType,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the first build to report.</p>
      )}

      {(target || summary.vulnCount > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {target && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warn/12 px-1.5 py-0.5 text-xs font-medium text-warn">
              <ShieldAlertIcon className="size-3.5" /> Node {target}
            </span>
          )}
          {ORDER.filter((s) => summary.vulnBySeverity[s]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <SeverityBadge severity={s} />×{summary.vulnBySeverity[s]}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>{latest ? `${latest.packageCount} packages` : "No packages"}</span>
        <span className={cn(stale && "text-warn")}>
          {lastBuildAt ? `Last build ${timeAgo(lastBuildAt)}` : "Never built"}
        </span>
      </div>
    </Link>
  );
}
