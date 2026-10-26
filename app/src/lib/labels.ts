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

/** The keys of all key:value labels, for a "group by" choice. */
export function labelKeys(sets: readonly (readonly string[])[]): string[] {
  const keys = new Set<string>();
  for (const set of sets) for (const l of set) if (l.includes(":")) keys.add(l.slice(0, l.indexOf(":")));
  return [...keys].sort();
}

/** Every wanted label is present. */
export function hasLabels(labels: readonly string[], wanted: readonly string[]): boolean {
  return wanted.every((w) => labels.includes(w));
}

export interface LabelSection<T> {
  /** The label value, or null for projects without the key. */
  value: string | null;
  items: T[];
}

/** Sections per value of a label key, alphabetical, with the projects without it last. */
export function sectionsByLabel<T>(
  items: T[],
  key: string,
  labelsOf: (t: T) => readonly string[],
): LabelSection<T>[] {
  const byValue = new Map<string | null, T[]>();
  for (const item of items) {
    const value = labelValue(labelsOf(item), key);
    byValue.set(value, [...(byValue.get(value) ?? []), item]);
  }
  return [...byValue]
    .map(([value, list]) => ({ value, items: list }))
    .sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value)));
}

export type ServerEntry<T> =
  { kind: "single"; item: T } | { kind: "group"; key: string; name: string; items: T[] };

/**
 * Collapses the servers of one app into one entry: projects that share a server key (a
 * shared key's split-by-IP projects with the same reported name). A key with a single
 * project, or a project without a key, stays on its own. Order follows the first member.
 */
export function groupServers<T>(
  items: T[],
  serverOf: (t: T) => { key: string; name: string } | null,
): ServerEntry<T>[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const s = serverOf(item);
    if (s) counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
  }
  const entries: ServerEntry<T>[] = [];
  const groups = new Map<string, ServerEntry<T> & { kind: "group" }>();
  for (const item of items) {
    const s = serverOf(item);
    if (!s || (counts.get(s.key) ?? 0) < 2) {
      entries.push({ kind: "single", item });
      continue;
    }
    const existing = groups.get(s.key);
    if (existing) existing.items.push(item);
    else {
      const group = { kind: "group" as const, key: s.key, name: s.name, items: [item] };
      groups.set(s.key, group);
      entries.push(group);
    }
  }
  return entries;
}
