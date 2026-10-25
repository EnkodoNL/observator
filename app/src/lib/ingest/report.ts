// SPDX-License-Identifier: FSL-1.1-ALv2

export interface ReportInput {
  projectName: string;
  projectUrl: string;
  nodeVersion: string;
  platform: string;
  lockfileType: string;
  packageCount: number;
  lockfileChanged: boolean;
  parseError?: string;
  warnings: string[];
  packagesPending: boolean;
  gate: "pass" | "fail" | null;
  gateReason?: string;
}

/** Plain-text summary printed in the build log by the Dockerfile snippet. */
export function renderReport(r: ReportInput): string {
  const lines: string[] = [];
  const details = [
    `node v${r.nodeVersion}`,
    r.platform,
    r.lockfileType === "none" ? "no lockfile" : r.lockfileType,
    r.lockfileType === "none" ? null : `${r.packageCount} packages`,
  ].filter(Boolean);
  lines.push(`Observator: recorded build for ${r.projectName} (${details.join(", ")})`);

  if (r.parseError) lines.push(`Observator: WARN lockfile not processed: ${r.parseError}`);
  if (r.lockfileType === "none")
    lines.push("Observator: no lockfile found; only the Node version is tracked");
  for (const w of r.warnings) lines.push(`Observator: WARN ${w}`);
  if (r.packagesPending) lines.push("Observator: package check running; results follow via notifications");
  if (r.warnings.length > 0) lines.push(`Observator: details: ${r.projectUrl}`);
  if (r.gate) lines.push(`OBSERVATOR_GATE=${r.gate}${r.gateReason ? ` (${r.gateReason})` : ""}`);
  return lines.join("\n") + "\n";
}
