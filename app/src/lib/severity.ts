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

const WORST_FIRST: Severity[] = ["critical", "high", "moderate", "low", "unknown"];

/** The worst severity with a count, if any. */
export const worstCounted = (counts: Partial<Record<Severity, number>>): Severity | null =>
  WORST_FIRST.find((s) => counts[s]) ?? null;

/** "2 high, 10 moderate": the `max` worst severities that have a count, worst first. */
export function countsText(counts: Partial<Record<Severity, number>>, max = 2): string {
  return WORST_FIRST.filter((s) => counts[s])
    .slice(0, max)
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
}
