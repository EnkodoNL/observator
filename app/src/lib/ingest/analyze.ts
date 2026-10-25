// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { activeIssues } from "@/lib/data/views";
import type { IssueEvent } from "@/lib/issues/events";
import { evaluateProject } from "@/lib/issues/evaluate";
import type { NodeEolData, NodeSecurityData, VulnIssueData } from "@/lib/issues/types";
import { pinnedImage } from "@/lib/node/advice";
import { checkProject } from "@/lib/osv/check";
import type { IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { atLeast, severityRank } from "@/lib/severity";
import type { IngestOutcome } from "./ingest";
import type { FailOn, IngestMeta } from "./request";

const GATE_BUDGET_MS = 20_000;

export interface Analysis {
  warnings: string[];
  packagesPending: boolean;
  gate: "pass" | "fail" | null;
  gateReason?: string;
  /** Events from the synchronous evaluation; published together with the background ones. */
  events: IssueEvent[];
}

function countBySeverity(issues: IssueRecord[]): string {
  const order: Severity[] = ["critical", "high", "moderate", "low", "unknown"];
  return order
    .map((s) => [s, issues.filter((i) => i.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
}

export function describeIssues(issues: IssueRecord[]): string[] {
  const open = issues.filter((i) => i.status === "open");
  const lines: string[] = [];
  const security = open.find((i) => i.kind === "node_security");
  if (security) {
    const d = security.data as unknown as NodeSecurityData;
    lines.push(
      `Node security update available: ${d.target}. Pin ${pinnedImage(d.target, d.os)} and redeploy.`,
    );
  }
  const eol = open.find((i) => i.kind === "node_eol");
  if (eol) {
    const d = eol.data as unknown as NodeEolData;
    lines.push(
      d.phase === "eol"
        ? `Node ${d.major} has been end-of-life since ${d.end}. Move to a supported release line.`
        : `Node ${d.major} reaches end-of-life on ${d.end}.`,
    );
  }
  const vulns = open
    .filter((i) => i.kind === "vuln")
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  if (vulns.length > 0) {
    lines.push(
      `${vulns.length} vulnerable package advisor${vulns.length === 1 ? "y" : "ies"} (${countBySeverity(vulns)})`,
    );
    for (const v of vulns.slice(0, 5)) {
      const d = v.data as unknown as VulnIssueData;
      const fix = d.fixedIn ? `, fixed in ${d.fixedIn}` : "";
      lines.push(`  ${d.package}@${d.version}: ${d.osvId} (${v.severity})${fix}${d.dev ? " [dev]" : ""}`);
    }
    if (vulns.length > 5) lines.push(`  ...and ${vulns.length - 5} more`);
  }
  return lines;
}

function gateDecision(failOn: FailOn, issues: IssueRecord[]): { gate: "pass" | "fail"; reason?: string } {
  const open = issues.filter((i) => i.status === "open");
  const reasons: string[] = [];
  if (failOn.severity) {
    const hits = open.filter((i) => i.kind === "vuln" && atLeast(i.severity, failOn.severity!));
    if (hits.length > 0)
      reasons.push(`${hits.length} advisor${hits.length === 1 ? "y" : "ies"} at ${failOn.severity} or above`);
  }
  if (failOn.node && open.some((i) => i.kind === "node_security"))
    reasons.push("Node security update available");
  return reasons.length ? { gate: "fail", reason: reasons.join("; ") } : { gate: "pass" };
}

/**
 * The part of the analysis that runs inside the ingest request: Node advice and the
 * advisories already known for these packages. A changed lockfile is checked against OSV
 * in the background, unless the build gate needs the answer now.
 */
export async function analyzeInline(
  project: ProjectRecord,
  outcome: IngestOutcome,
  meta: IngestMeta,
): Promise<Analysis> {
  const gateRequested = Boolean(meta.failOn.severity || meta.failOn.node);
  let packagesPending = outcome.lockfileChanged && outcome.packageCount > 0;
  let gateNote: string | undefined;

  if (packagesPending && gateRequested && meta.failOn.severity) {
    try {
      await checkProject(project.id, AbortSignal.timeout(GATE_BUDGET_MS));
      packagesPending = false;
    } catch (err) {
      console.warn("[ingest] inline package check failed:", String(err));
      gateNote = "package check did not finish in time; only known advisories were considered";
    }
  }

  const events = await evaluateProject(project.id);
  const issues = await activeIssues(project.id);
  const decision = gateRequested ? gateDecision(meta.failOn, issues) : null;

  return {
    warnings: describeIssues(issues),
    packagesPending,
    gate: decision?.gate ?? null,
    gateReason: [decision?.reason, gateNote].filter(Boolean).join("; ") || undefined,
    events,
  };
}

/** Runs after the response: OSV check for a new lockfile, then one bundled publish. */
export async function analyzeInBackground(projectId: string, analysis: Analysis): Promise<IssueEvent[]> {
  if (!analysis.packagesPending) return analysis.events;
  try {
    await checkProject(projectId);
  } catch (err) {
    console.warn("[ingest] package check failed, the daily re-check will retry:", String(err));
  }
  return [...analysis.events, ...(await evaluateProject(projectId))];
}
