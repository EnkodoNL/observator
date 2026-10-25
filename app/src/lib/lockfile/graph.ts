// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Component } from "./types";

/**
 * Format-independent dependency graph. Node ids are parser-specific (install paths for
 * npm, lockfile keys for yarn and pnpm); names and versions are the real package names.
 */
export class DepGraph {
  readonly nodes = new Map<string, { name: string; version: string }>();
  readonly edges = new Map<string, Set<string>>();
  readonly prodRoots = new Set<string>();
  readonly devRoots = new Set<string>();
  /** Authoritative dev flags where the lockfile records them (npm, pnpm v6). */
  readonly devFlags = new Map<string, boolean>();

  addNode(id: string, name: string, version: string): void {
    this.nodes.set(id, { name, version });
  }

  addEdge(from: string, to: string): void {
    let set = this.edges.get(from);
    if (!set) this.edges.set(from, (set = new Set()));
    set.add(to);
  }

  private reach(starts: Iterable<string>): Set<string> {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !this.nodes.has(id)) continue;
      seen.add(id);
      for (const next of this.edges.get(id) ?? []) if (!seen.has(next)) stack.push(next);
    }
    return seen;
  }

  /** Collapses the graph into one component per name@version. */
  toComponents(): Component[] {
    const prod = this.reach(this.prodRoots);
    const roots = [...this.prodRoots, ...this.devRoots].filter((id) => this.nodes.has(id));

    const via = new Map<string, Set<string>>();
    for (const root of roots) {
      const rootName = this.nodes.get(root)!.name;
      for (const id of this.reach([root])) {
        if (id === root) continue;
        let set = via.get(id);
        if (!set) via.set(id, (set = new Set()));
        if (set.size < 3) set.add(rootName);
      }
    }

    const merged = new Map<string, Component>();
    for (const [id, node] of this.nodes) {
      const dev = this.devFlags.get(id) ?? !prod.has(id);
      const direct = this.prodRoots.has(id) || this.devRoots.has(id);
      const key = `${node.name}@${node.version}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          name: node.name,
          version: node.version,
          direct,
          dev,
          via: [...(via.get(id) ?? [])],
        });
        continue;
      }
      existing.direct ||= direct;
      existing.dev &&= dev;
      for (const v of via.get(id) ?? [])
        if (existing.via.length < 3 && !existing.via.includes(v)) existing.via.push(v);
    }

    return [...merged.values()]
      .map((c) => (c.direct ? { ...c, via: [] } : c))
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  }
}
