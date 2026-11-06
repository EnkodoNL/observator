// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IssueKind, Severity } from "@/lib/pb/types";
import type { Runtime, RuntimeEvaluation } from "@/lib/runtimes/types";
import { GO_ECOSYSTEM } from "@/lib/lockfile/go";
import { maxSeverity } from "@/lib/severity";
import type { RuntimeEolData, RuntimeSecurityData, StaleData, VulnIssueData } from "./types";

export interface DesiredIssue {
  kind: IssueKind;
  key: string;
  revision: string;
  severity: Severity;
  title: string;
  data: VulnIssueData | RuntimeSecurityData | RuntimeEolData | StaleData;
}

export interface ComponentInput {
  ecosystem: string;
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  via: string[];
}

export interface VulnInput {
  ecosystem: string;
  name: string;
  version: string;
  osvId: string;
  aliases: string[];
  severity: Severity;
  summary: string;
  fixedIn: string;
  url: string;
}

export interface DesiredInput {
  build: { runtimes: Runtime[]; os: string } | null;
  lastBuildAt: Date | null;
  components: ComponentInput[];
  vulns: VulnInput[];
  /** One per reported runtime that has release data. */
  evaluations: RuntimeEvaluation[];
  staleDays: number;
  now: Date;
}

/** Everything that should be open for a project, given its current state. */
export function computeDesired(input: DesiredInput): DesiredIssue[] {
  const out: DesiredIssue[] = [];
  const { build } = input;

  for (const ev of build ? input.evaluations : []) {
    if (ev.securityUpdate) {
      out.push({
        kind: "runtime_security",
        key: `runtime_security:${ev.runtime}:${ev.line}`,
        revision: ev.securityUpdate.target,
        severity: "high",
        title: `${ev.label} ${ev.version} has a security update: ${ev.securityUpdate.target}`,
        data: {
          runtime: ev.runtime,
          running: ev.version,
          target: ev.securityUpdate.target,
          line: ev.line,
          securityReleases: ev.securityUpdate.releases,
          os: build!.os,
        },
      });
    }
    if (ev.end && (ev.phase === "eol" || ev.eolSoon)) {
      const phase = ev.phase === "eol" ? "eol" : "soon";
      out.push({
        kind: "runtime_eol",
        key: `runtime_eol:${ev.runtime}:${ev.line}`,
        revision: phase,
        severity: phase === "eol" ? "high" : "moderate",
        title:
          phase === "eol"
            ? `${ev.label} ${ev.line} is end-of-life`
            : `${ev.label} ${ev.line} reaches end-of-life on ${ev.end}`,
        data: { runtime: ev.runtime, running: ev.version, line: ev.line, end: ev.end, phase },
      });
    }
  }

  // One issue per advisory per package name; several installed versions share it, so an
  // upgrade that is still vulnerable does not look like "resolved + new".
  const pkg = (x: { ecosystem: string; name: string }) => `${x.ecosystem}:${x.name}`;
  const components = new Map<string, ComponentInput[]>();
  for (const c of input.components) components.set(pkg(c), [...(components.get(pkg(c)) ?? []), c]);
  const perPackage = new Map<string, VulnInput[]>();
  for (const v of input.vulns) {
    if (!components.get(pkg(v))?.some((c) => c.version === v.version)) continue;
    perPackage.set(pkg(v), [...(perPackage.get(pkg(v)) ?? []), v]);
  }
  const vulnIssues: DesiredIssue[] = [];
  for (const list of perPackage.values())
    for (const group of aliasGroups(list)) {
      const lead = leadOf(group);
      const versions = [...new Set(group.map((v) => v.version))].sort();
      const affected = (components.get(pkg(lead)) ?? []).filter((c) => versions.includes(c.version));
      const fixed = lead.fixedIn || (group.map((v) => v.fixedIn).find(Boolean) ?? "");
      vulnIssues.push({
        kind: "vuln",
        key: `vuln:${lead.osvId}:${lead.name}`,
        revision: "",
        severity: maxSeverity(group.map((v) => v.severity)) ?? "unknown",
        title: `${lead.name}@${versions.join(", ")}: ${lead.summary || lead.osvId}`,
        data: {
          ecosystem: lead.ecosystem,
          package: lead.name,
          version: versions.join(", "),
          osvId: lead.osvId,
          aliases: [...new Set(group.flatMap((v) => [v.osvId, ...v.aliases]))].filter(
            (a) => a !== lead.osvId,
          ),
          summary: lead.summary,
          // OSV writes Go versions without the v that go get and go.mod need.
          fixedIn: fixed && lead.ecosystem === GO_ECOSYSTEM && !fixed.startsWith("v") ? `v${fixed}` : fixed,
          url: lead.url,
          direct: affected.some((c) => c.direct),
          dev: affected.every((c) => c.dev),
          via: [...new Set(affected.flatMap((c) => c.via))].slice(0, 3),
        },
      });
    }
  out.push(...vulnIssues.sort((a, b) => a.key.localeCompare(b.key)));

  if (input.lastBuildAt) {
    const days = Math.floor((input.now.getTime() - input.lastBuildAt.getTime()) / (24 * 3600 * 1000));
    if (days >= input.staleDays) {
      out.push({
        kind: "stale",
        key: "stale",
        revision: "",
        severity: "low",
        title: `No build for ${days} days`,
        data: { lastBuildAt: input.lastBuildAt.toISOString(), days },
      });
    }
  }
  return out;
}

/**
 * Advisories of one package that name each other, such as a GO- record from the Go vulnerability
 * database and the GHSA it aliases: one problem, so one issue.
 */
function aliasGroups(list: VulnInput[]): VulnInput[][] {
  const groups: { ids: Set<string>; items: VulnInput[] }[] = [];
  for (const v of list) {
    const ids = new Set([v.osvId, ...v.aliases]);
    const hits = groups.filter((g) => [...ids].some((id) => g.ids.has(id)));
    const merged = { ids, items: [v] };
    for (const g of hits) {
      for (const id of g.ids) merged.ids.add(id);
      merged.items.push(...g.items);
      groups.splice(groups.indexOf(g), 1);
    }
    groups.push(merged);
  }
  return groups.map((g) => g.items);
}

/** The record that speaks for a group: one with a rating, a GHSA before others, then by id. */
function leadOf(group: VulnInput[]): VulnInput {
  const score = (v: VulnInput) => (v.severity !== "unknown" ? 2 : 0) + (v.osvId.startsWith("GHSA-") ? 1 : 0);
  return [...group].sort((a, b) => score(b) - score(a) || a.osvId.localeCompare(b.osvId))[0];
}
