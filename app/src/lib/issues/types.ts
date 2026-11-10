// SPDX-License-Identifier: FSL-1.1-ALv2

/** issues.data for kind "vuln". */
export interface VulnIssueData {
  /** OSV ecosystem; absent on issues from before ecosystems were recorded (all npm). */
  ecosystem?: string;
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

/** issues.data for kind "runtime_security". */
export interface RuntimeSecurityData {
  runtime: string;
  running: string;
  target: string;
  /** The release line: "22" for Node. */
  line: string;
  securityReleases: string[];
  /** /etc/os-release ID of the reporting image, to pick the image tag to pin. */
  os: string;
}

/** issues.data for kind "runtime_eol". */
export interface RuntimeEolData {
  runtime: string;
  running: string;
  line: string;
  end: string;
  phase: "soon" | "eol";
}

/**
 * issues.data for kind "stale". "age": no report for staleDays and nothing that says why;
 * "deploy": Coolify deployed after the last report and no report came. Issues from before the
 * reason have none and are "age".
 */
export interface StaleData {
  lastBuildAt: string;
  days: number;
  reason?: "age" | "deploy";
  /** The silent deployment, for "deploy". */
  deploy?: { at: string; commit: string | null };
}

export const staleReason = (data: unknown): "age" | "deploy" =>
  (data as Partial<StaleData> | null)?.reason === "deploy" ? "deploy" : "age";

/** A vuln issue covers every installed version of the package with that advisory. */
export function vulnVersions(d: Pick<VulnIssueData, "version">): string[] {
  return d.version.split(", ").filter(Boolean);
}
