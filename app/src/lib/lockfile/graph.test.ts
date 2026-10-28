// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { DepGraph, MAX_PACKAGES } from "./graph";
import { LockfileError } from "./types";

/** The attribution as it was: a full walk per root, first three roots in order. */
function bruteVia(g: DepGraph): Map<string, string[]> {
  const via = new Map<string, string[]>();
  for (const root of [...g.prodRoots, ...g.devRoots].filter((id) => g.nodes.has(id))) {
    const seen = new Set<string>();
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !g.nodes.has(id)) continue;
      seen.add(id);
      for (const next of g.edges.get(id) ?? []) stack.push(next);
    }
    for (const id of seen) {
      if (id === root) continue;
      const list = via.get(id) ?? [];
      if (list.length < 3 && !list.includes(g.nodes.get(root)!.name)) list.push(g.nodes.get(root)!.name);
      via.set(id, list);
    }
  }
  return via;
}

function random(seed: number, size: number): DepGraph {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const g = new DepGraph();
  for (let i = 0; i < size; i++) g.addNode(`n${i}`, `p${i % Math.ceil(size * 0.8)}`, "1.0.0");
  for (let i = 0; i < size * 2; i++)
    g.addEdge(`n${Math.floor(rand() * size)}`, `n${Math.floor(rand() * size)}`);
  for (let i = 0; i < size / 5; i++)
    (rand() < 0.7 ? g.prodRoots : g.devRoots).add(`n${Math.floor(rand() * size)}`);
  return g;
}

describe("DepGraph via", () => {
  it("names the same roots as a full walk per root", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = random(seed, 60);
      const expected = bruteVia(g);
      for (const c of g.toComponents()) {
        if (c.direct) continue;
        const ids = [...g.nodes].filter(([, n]) => `${n.name}@${n.version}` === `${c.name}@${c.version}`);
        const merged: string[] = [];
        for (const [id] of ids)
          for (const v of expected.get(id) ?? [])
            if (merged.length < 3 && !merged.includes(v)) merged.push(v);
        expect(c.via, `seed ${seed}, ${c.name}`).toEqual(merged);
      }
    }
  });

  it("stays fast when every package is a root of one long chain", () => {
    const g = new DepGraph();
    const n = MAX_PACKAGES;
    for (let i = 0; i < n; i++) {
      g.addNode(`n${i}`, `p${i}`, "1.0.0");
      if (i) g.addEdge(`n${i - 1}`, `n${i}`);
      g.prodRoots.add(`n${i}`);
    }
    const start = performance.now();
    g.toComponents();
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("refuses more packages than the ceiling", () => {
    const g = new DepGraph();
    for (let i = 0; i < MAX_PACKAGES; i++) g.addNode(`n${i}`, "p", String(i));
    expect(() => g.addNode("one-more", "p", "x")).toThrow(LockfileError);
  });
});
