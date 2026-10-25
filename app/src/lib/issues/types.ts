// SPDX-License-Identifier: FSL-1.1-ALv2

/** issues.data for kind "vuln". */
export interface VulnIssueData {
  package: string;
  version: string;
  osvId: string;
  aliases: string[];
  summary: string;
  fixedIn: string;
  url: string;
  direct: boolean;
  dev: boolean;
  via: string[];
}

/** issues.data for kind "node_security". */
export interface NodeSecurityData {
  running: string;
  target: string;
  major: number;
  securityReleases: string[];
  os: string;
}

/** issues.data for kind "node_eol". */
export interface NodeEolData {
  running: string;
  major: number;
  end: string;
  phase: "soon" | "eol";
}

/** issues.data for kind "stale". */
export interface StaleData {
  lastBuildAt: string;
  days: number;
}

/** A vuln issue covers every installed version of the package with that advisory. */
export function vulnVersions(d: Pick<VulnIssueData, "version">): string[] {
  return d.version.split(", ").filter(Boolean);
}
