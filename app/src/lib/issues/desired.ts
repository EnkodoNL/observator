// SPDX-License-Identifier: FSL-1.1-ALv2
import type { NodeEvaluation } from "@/lib/node/evaluate";
import type { IssueKind, Severity } from "@/lib/pb/types";
import { maxSeverity } from "@/lib/severity";
import type { NodeEolData, NodeSecurityData, StaleData, VulnIssueData } from "./types";

export interface DesiredIssue {
  kind: IssueKind;
  key: string;
  revision: string;
  severity: Severity;
  title: string;
  data: VulnIssueData | NodeSecurityData | NodeEolData | StaleData;
}

export interface ComponentInput {
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  via: string[];
}

export interface VulnInput {
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
  build: { nodeVersion: string; os: string } | null;
  lastBuildAt: Date | null;
  components: ComponentInput[];
  vulns: VulnInput[];
  node: NodeEvaluation | null;
  staleDays: number;
  now: Date;
}

/** Everything that should be open for a project, given its current state. */
export function computeDesired(input: DesiredInput): DesiredIssue[] {
  const out: DesiredIssue[] = [];
  const { build, node } = input;

  if (build && node?.securityUpdate) {
    out.push({
      kind: "node_security",
      key: `node_security:${node.major}`,
      revision: node.securityUpdate.target,
      severity: "high",
      title: `Node ${build.nodeVersion} has a security update: ${node.securityUpdate.target}`,
      data: {
        running: build.nodeVersion,
        target: node.securityUpdate.target,
        major: node.major,
        securityReleases: node.securityUpdate.releases,
        os: build.os,
      },
    });
  }

  if (build && node && node.end && (node.phase === "eol" || node.eolSoon)) {
    const phase = node.phase === "eol" ? "eol" : "soon";
    out.push({
      kind: "node_eol",
      key: `node_eol:${node.major}`,
      revision: phase,
      severity: phase === "eol" ? "high" : "moderate",
      title:
        phase === "eol"
          ? `Node ${node.major} is end-of-life`
          : `Node ${node.major} reaches end-of-life on ${node.end}`,
      data: { running: build.nodeVersion, major: node.major, end: node.end, phase },
    });
  }

  // One issue per advisory per package name; several installed versions share it, so an
  // upgrade that is still vulnerable does not look like "resolved + new".
  const components = new Map<string, ComponentInput[]>();
  for (const c of input.components) components.set(c.name, [...(components.get(c.name) ?? []), c]);
  const grouped = new Map<string, VulnInput[]>();
  for (const v of input.vulns) {
    if (!components.get(v.name)?.some((c) => c.version === v.version)) continue;
    const key = `vuln:${v.osvId}:${v.name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), v]);
  }
  for (const [key, list] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const first = list[0];
    const versions = [...new Set(list.map((v) => v.version))].sort();
    const affected = (components.get(first.name) ?? []).filter((c) => versions.includes(c.version));
    out.push({
      kind: "vuln",
      key,
      revision: "",
      severity: maxSeverity(list.map((v) => v.severity)) ?? "unknown",
      title: `${first.name}@${versions.join(", ")}: ${first.summary || first.osvId}`,
      data: {
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
