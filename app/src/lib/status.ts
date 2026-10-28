// SPDX-License-Identifier: FSL-1.1-ALv2
import type { VulnIssueData } from "@/lib/issues/types";
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
  /** Open runtime security updates, one per runtime line. */
  runtimeSecurity: IssueRecord[];
  runtimeEol: IssueRecord[];
  /** Open package advisories that count (ignored ones are not open). */
  vulns: IssueRecord[];
  /** Open advisories in dev dependencies, when those do not count: not in the running image. */
  buildOnly: IssueRecord[];
  vulnCount: number;
  vulnBySeverity: Partial<Record<Severity, number>>;
  worstSeverity: Severity | null;
  stale: boolean;
}

/** An advisory in a package only dev dependencies pull in. */
export const isDevVuln = (issue: { kind: string; data?: unknown }) =>
  issue.kind === "vuln" && Boolean((issue.data as Partial<VulnIssueData> | null)?.dev);

/**
 * Derives the dashboard status of a project from its open issues. Advisories in dev
 * dependencies only count with countDev; otherwise they are listed as build-only.
 */
export function summarize(hasBuild: boolean, issues: IssueRecord[], countDev = false): StatusSummary {
  const open = issues.filter((i) => i.status === "open");
  const allVulns = open.filter((i) => i.kind === "vuln");
  const vulns = countDev ? allVulns : allVulns.filter((i) => !isDevVuln(i));
  const buildOnly = countDev ? [] : allVulns.filter(isDevVuln);
  const runtimeSecurity = open.filter((i) => i.kind === "runtime_security");
  const runtimeEol = open.filter((i) => i.kind === "runtime_eol");
  const vulnBySeverity: Partial<Record<Severity, number>> = {};
  for (const v of vulns) vulnBySeverity[v.severity] = (vulnBySeverity[v.severity] ?? 0) + 1;

  let status: ProjectStatus = "ok";
  if (!hasBuild) status = "none";
  else if (vulns.length > 0) status = "vulnerable";
  else if (runtimeSecurity.length || runtimeEol.length) status = "update";

  return {
    status,
    runtimeSecurity,
    runtimeEol,
    vulns,
    buildOnly,
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
