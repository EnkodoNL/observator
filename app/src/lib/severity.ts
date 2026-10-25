// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Severity } from "@/lib/pb/types";

const RANK: Record<Severity, number> = { unknown: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export const severityRank = (s: Severity | "" | null | undefined): number => RANK[s || "unknown"] ?? 0;

export const atLeast = (s: Severity, min: Severity): boolean => severityRank(s) >= severityRank(min);

export function maxSeverity(list: Severity[]): Severity | null {
  return list.reduce<Severity | null>((max, s) => (max === null || RANK[s] > RANK[max] ? s : max), null);
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  unknown: "Unknown",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
};
