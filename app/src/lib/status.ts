// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IssueRecord, Severity } from "@/lib/pb/types";
import { maxSeverity } from "@/lib/severity";
import { daysSince } from "@/lib/time";

export type ProjectStatus = "none" | "ok" | "update" | "vulnerable";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  none: "No builds yet",
  ok: "OK",
  update: "Update available",
  vulnerable: "Vulnerable",
};

const STATUS_RANK: Record<ProjectStatus, number> = { none: 0, ok: 1, update: 2, vulnerable: 3 };

/** The status a group of projects gets: that of its worst member. */
export function worstStatus(statuses: ProjectStatus[]): ProjectStatus {
  return statuses.reduce<ProjectStatus>((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), "none");
}

export interface StatusSummary {
  status: ProjectStatus;
  nodeSecurity: IssueRecord | null;
  nodeEol: IssueRecord | null;
  vulnCount: number;
  vulnBySeverity: Partial<Record<Severity, number>>;
  worstSeverity: Severity | null;
  stale: boolean;
}

/** Derives the dashboard status of a project from its open issues. */
export function summarize(hasBuild: boolean, issues: IssueRecord[]): StatusSummary {
  const open = issues.filter((i) => i.status === "open");
  const vulns = open.filter((i) => i.kind === "vuln");
  const nodeSecurity = open.find((i) => i.kind === "node_security") ?? null;
  const nodeEol = open.find((i) => i.kind === "node_eol") ?? null;
  const vulnBySeverity: Partial<Record<Severity, number>> = {};
  for (const v of vulns) vulnBySeverity[v.severity] = (vulnBySeverity[v.severity] ?? 0) + 1;

  let status: ProjectStatus = "ok";
  if (!hasBuild) status = "none";
  else if (vulns.length > 0) status = "vulnerable";
  else if (nodeSecurity || nodeEol) status = "update";

  return {
    status,
    nodeSecurity,
    nodeEol,
    vulnCount: vulns.length,
    vulnBySeverity,
    worstSeverity: maxSeverity(vulns.map((v) => v.severity)),
    stale: open.some((i) => i.kind === "stale"),
  };
}

/**
 * Stale: an open stale issue, or no build for staleDays. The second part shows it before the
 * hourly job has opened the issue.
 */
export function isStale(
  summary: Pick<StatusSummary, "stale">,
  lastBuildAt: Date | null,
  staleDays: number,
): boolean {
  const age = daysSince(lastBuildAt);
  return summary.stale || (age !== null && age >= staleDays);
}
