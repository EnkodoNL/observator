// SPDX-License-Identifier: FSL-1.1-ALv2
import type { IssueKind, Severity } from "@/lib/pb/types";
import type { Runtime, RuntimeEvaluation } from "@/lib/runtimes/types";
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
  const grouped = new Map<string, VulnInput[]>();
  for (const v of input.vulns) {
    if (!components.get(pkg(v))?.some((c) => c.version === v.version)) continue;
    const key = `vuln:${v.osvId}:${v.name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), v]);
  }
  for (const [key, list] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const first = list[0];
    const versions = [...new Set(list.map((v) => v.version))].sort();
    const affected = (components.get(pkg(first)) ?? []).filter((c) => versions.includes(c.version));
    out.push({
      kind: "vuln",
      key,
      revision: "",
      severity: maxSeverity(list.map((v) => v.severity)) ?? "unknown",
      title: `${first.name}@${versions.join(", ")}: ${first.summary || first.osvId}`,
      data: {
        ecosystem: first.ecosystem,
        package: first.name,
        version: versions.join(", "),
        osvId: first.osvId,
        aliases: first.aliases,
        summary: first.summary,
        fixedIn: list.map((v) => v.fixedIn).find(Boolean) ?? "",
        url: first.url,
        direct: affected.some((c) => c.direct),
        dev: affected.every((c) => c.dev),
        via: [...new Set(affected.flatMap((c) => c.via))].slice(0, 3),
      },
    });
  }

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
