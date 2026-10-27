// SPDX-License-Identifier: FSL-1.1-ALv2
import type { ProjectSummary } from "@/lib/data/views";
import type { RuntimeEolData, RuntimeSecurityData, VulnIssueData } from "@/lib/issues/types";
import { vulnVersions } from "@/lib/issues/types";
import { packageHref } from "@/lib/package-href";
import type { IssueRecord, Severity } from "@/lib/pb/types";
import { severityRank } from "@/lib/severity";
import { isStale } from "@/lib/status";

export interface ProjectRef {
  name: string;
  slug: string;
}

/**
 * One thing to do, with every project it applies to: a package to update, a runtime to
 * patch or replace, or builds that stopped reporting.
 */
export type Cause = { key: string; severity: Severity; projects: ProjectRef[]; href: string } & (
  | {
      kind: "package";
      package: string;
      versions: string[];
      /** The version that fixes every advisory, when they agree. */
      fixedIn: string | null;
      advisories: number;
    }
  | { kind: "runtime_security"; runtime: string; running: string; target: string }
  | {
      kind: "runtime_eol";
      runtime: string;
      running: string;
      line: string;
      end: string;
      phase: "soon" | "eol";
    }
  | { kind: "stale" }
);

const KIND_ORDER: Record<Cause["kind"], number> = {
  runtime_security: 0,
  package: 1,
  runtime_eol: 2,
  stale: 3,
};

const ref = (i: ProjectSummary): ProjectRef => ({ name: i.project.name, slug: i.project.slug });
const data = <T>(issue: IssueRecord) => issue.data as unknown as T;
const projectHref = (projects: ProjectRef[]) =>
  projects.length === 1 ? `/projects/${projects[0].slug}` : "";

/** What needs doing across all projects, the heaviest first: severity, then reach. */
export function triage(items: ProjectSummary[], staleDays: number): Cause[] {
  const causes = new Map<string, Cause>();
  const add = (key: string, make: () => Cause, item: ProjectSummary, severity: Severity) => {
    const cause = causes.get(key) ?? make();
    causes.set(key, cause);
    if (!cause.projects.some((p) => p.slug === item.project.slug)) cause.projects.push(ref(item));
    if (severityRank(severity) > severityRank(cause.severity)) cause.severity = severity;
    return cause;
  };

  for (const item of items) {
    if (!item.latest) continue;
    for (const issue of item.summary.runtimeSecurity) {
      const d = data<RuntimeSecurityData>(issue);
      add(
        `rs:${d.runtime}:${d.running}:${d.target}`,
        () => ({ key: "", kind: "runtime_security", severity: issue.severity, projects: [], href: "", ...d }),
        item,
        issue.severity,
      );
    }
    for (const issue of item.summary.runtimeEol) {
      const d = data<RuntimeEolData>(issue);
      add(
        `eol:${d.runtime}:${d.line}`,
        () => ({ key: "", kind: "runtime_eol", severity: issue.severity, projects: [], href: "", ...d }),
        item,
        issue.severity,
      );
    }
    for (const issue of item.summary.vulns) {
      const d = data<VulnIssueData>(issue);
      const cause = add(
        `pkg:${d.ecosystem ?? "npm"}:${d.package}`,
        () => ({
          key: "",
          kind: "package",
          severity: issue.severity,
          projects: [],
          href: packageHref(d.package),
          package: d.package,
          versions: [],
          fixedIn: d.fixedIn || null,
          advisories: 0,
        }),
        item,
        issue.severity,
      );
      if (cause.kind !== "package") continue;
      for (const v of vulnVersions(d)) if (!cause.versions.includes(v)) cause.versions.push(v);
      if (cause.fixedIn !== (d.fixedIn || null)) cause.fixedIn = null;
    }
    if (isStale(item.summary, item.lastBuildAt, staleDays))
      add("stale", () => ({ key: "", kind: "stale", severity: "low", projects: [], href: "" }), item, "low");
  }

  // Advisories count per package, not per project: the same one in seven projects is one.
  const advisories = new Map<string, Set<string>>();
  for (const item of items)
    for (const issue of item.summary.vulns) {
      const d = data<VulnIssueData>(issue);
      const key = `pkg:${d.ecosystem ?? "npm"}:${d.package}`;
      advisories.set(key, (advisories.get(key) ?? new Set()).add(d.osvId));
    }

  return [...causes]
    .map(([key, cause]) => {
      if (cause.kind === "package") {
        cause.advisories = advisories.get(key)?.size ?? 0;
        cause.versions.sort();
      }
      cause.projects.sort((a, b) => a.name.localeCompare(b.name));
      return { ...cause, key, href: cause.href || projectHref(cause.projects) };
    })
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        b.projects.length - a.projects.length ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.key.localeCompare(b.key),
    );
}
