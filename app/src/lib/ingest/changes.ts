// SPDX-License-Identifier: FSL-1.1-ALv2
import type { BuildChanges } from "@/lib/pb/types";

const LIMIT = 500;

type Pkg = { name: string; version: string };

function byName(list: Pkg[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { name, version } of list) {
    const versions = map.get(name) ?? [];
    if (!versions.includes(version)) versions.push(version);
    map.set(name, versions);
  }
  for (const versions of map.values()) versions.sort();
  return map;
}

/** Package-level diff between two component sets, capped so a first build stays small. */
export function diffComponents(before: Pkg[], after: Pkg[]): Omit<BuildChanges, "node"> {
  const old = byName(before);
  const next = byName(after);
  const added: Pkg[] = [];
  const removed: Pkg[] = [];
  const changed: BuildChanges["changed"] = [];

  for (const [name, versions] of next) {
    const prev = old.get(name);
    if (!prev) for (const version of versions) added.push({ name, version });
    else if (prev.join() !== versions.join())
      changed.push({ name, from: prev.join(", "), to: versions.join(", ") });
  }
  for (const [name, versions] of old) {
    if (!next.has(name)) for (const version of versions) removed.push({ name, version });
  }

  const sort = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const truncated = added.length > LIMIT || removed.length > LIMIT || changed.length > LIMIT;
  return {
    added: added.sort(sort).slice(0, LIMIT),
    removed: removed.sort(sort).slice(0, LIMIT),
    changed: changed.sort(sort).slice(0, LIMIT),
    ...(truncated ? { truncated } : {}),
  };
}
