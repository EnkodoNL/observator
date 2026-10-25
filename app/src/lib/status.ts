// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IssueRecord, Severity } from "@/lib/pb/types";
import { maxSeverity } from "@/lib/severity";

export type ProjectStatus = "none" | "ok" | "update" | "vulnerable";

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
