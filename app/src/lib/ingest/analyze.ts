// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { activeIssues } from "@/lib/data/views";
import type { IssueEvent } from "@/lib/issues/events";
import { evaluateProject } from "@/lib/issues/evaluate";
import type { RuntimeEolData, RuntimeSecurityData, VulnIssueData } from "@/lib/issues/types";
import { pinFor, runtimeLabel } from "@/lib/runtimes";
import { checkProject } from "@/lib/osv/check";
import type { IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { getSettings } from "@/lib/settings";
import { atLeast, severityRank } from "@/lib/severity";
import { isDevVuln } from "@/lib/status";
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

export function describeIssues(issues: IssueRecord[], countDev: boolean): string[] {
  const open = issues.filter((i) => i.status === "open");
  const lines: string[] = [];
  for (const security of open.filter((i) => i.kind === "runtime_security")) {
    const d = security.data as unknown as RuntimeSecurityData;
    const pin = pinFor(d.runtime, d.target, d.os);
    lines.push(
      `${runtimeLabel(d.runtime)} security update available: ${d.target}.${pin ? ` Pin ${pin} and redeploy.` : ""}`,
    );
  }
  for (const eol of open.filter((i) => i.kind === "runtime_eol")) {
    const d = eol.data as unknown as RuntimeEolData;
    lines.push(
      d.phase === "eol"
        ? `${runtimeLabel(d.runtime)} ${d.line} has been end-of-life since ${d.end}. Move to a supported release line.`
        : `${runtimeLabel(d.runtime)} ${d.line} reaches end-of-life on ${d.end}.`,
    );
  }
  const buildOnly = countDev ? [] : open.filter(isDevVuln);
  const vulns = open
    .filter((i) => i.kind === "vuln" && !buildOnly.includes(i))
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
  if (buildOnly.length > 0)
    lines.push(
      `${buildOnly.length} advisor${buildOnly.length === 1 ? "y" : "ies"} in dev dependencies only, not counted (${countBySeverity(buildOnly)})`,
    );
  return lines;
}

function gateDecision(
  failOn: FailOn,
  issues: IssueRecord[],
  countDev: boolean,
): { gate: "pass" | "fail"; reason?: string } {
  const open = issues.filter((i) => i.status === "open" && (countDev || !isDevVuln(i)));
  const reasons: string[] = [];
  if (failOn.severity) {
    const hits = open.filter((i) => i.kind === "vuln" && atLeast(i.severity, failOn.severity!));
    if (hits.length > 0)
      reasons.push(`${hits.length} advisor${hits.length === 1 ? "y" : "ies"} at ${failOn.severity} or above`);
  }
  const runtimeHits = open.filter((i) => {
    const runtime = (i.data as unknown as RuntimeSecurityData | null)?.runtime ?? "";
    return (
      i.kind === "runtime_security" && (failOn.runtimes.includes("*") || failOn.runtimes.includes(runtime))
    );
  });
  for (const i of runtimeHits)
    reasons.push(
      `${runtimeLabel((i.data as unknown as RuntimeSecurityData).runtime)} security update available`,
    );
  return reasons.length ? { gate: "fail", reason: reasons.join("; ") } : { gate: "pass" };
}

/**
 * The part of the analysis that runs inside the ingest request: runtime advice and the
 * advisories already known for these packages. A changed lockfile is checked against OSV
 * in the background, unless the build gate needs the answer now.
 */
export async function analyzeInline(
  project: ProjectRecord,
  outcome: IngestOutcome,
  meta: IngestMeta,
): Promise<Analysis> {
  const gateRequested = Boolean(meta.failOn.severity || meta.failOn.runtimes.length);
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
  const { countDevDependencies: countDev } = await getSettings();
  const decision = gateRequested ? gateDecision(meta.failOn, issues, countDev) : null;

  return {
    warnings: describeIssues(issues, countDev),
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
