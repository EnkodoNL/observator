// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * Labels on projects: a plain word ("critical") or key:value ("app:heatwave", "env:prod").
 * Always lowercase, so "Env:Prod" and "env:prod" are one label. A project has labels kept by
 * hand (UI, MCP) and labels from its latest build (OBSERVATOR_LABELS); it shows both.
 */

export const MAX_LABELS = 20;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,31}(?::[a-z0-9][a-z0-9._/-]{0,62})?$/;

/** Comma- or space-separated text, or a list. Invalid labels come back separately. */
export function parseLabels(input: string | readonly string[]): { labels: string[]; invalid: string[] } {
  const parts = (typeof input === "string" ? input.split(/[\s,]+/) : [...input])
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const labels: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!LABEL.test(p)) invalid.push(p.slice(0, 100));
    else if (labels.includes(p)) continue;
    else if (labels.length >= MAX_LABELS) invalid.push(p);
    else labels.push(p);
  }
  return { labels, invalid };
}

/** The labels a project shows: its own plus those of its latest build, sorted. */
export function effectiveLabels(p: { labels?: string[] | null; buildLabels?: string[] | null }): string[] {
  return [...new Set([...(p.labels ?? []), ...(p.buildLabels ?? [])])].sort();
}

/** "heatwave" for key "app" in ["app:heatwave", "env:prod"]. */
export function labelValue(labels: readonly string[], key: string): string | null {
  const found = labels.find((l) => l.startsWith(`${key}:`));
  return found ? found.slice(key.length + 1) : null;
}

/** Every wanted label is present. */
export function hasLabels(labels: readonly string[], wanted: readonly string[]): boolean {
  return wanted.every((w) => labels.includes(w));
}
