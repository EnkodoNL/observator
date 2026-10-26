// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { diffRuntimes } from "@/lib/ingest/changes";
import index from "./node/__fixtures__/index.json";
import schedule from "./node/__fixtures__/schedule.json";
import { compactIndex, nodeEvaluator } from "./node/evaluate";
import { evaluateRuntimes, PROVIDERS } from "./index";
import {
  CHECKED_RUNTIMES,
  formatRuntimes,
  lineDescription,
  pinFor,
  primaryRuntime,
  runtimeLabel,
} from "./labels";
import type { Evaluator } from "./types";

const now = new Date("2026-10-25T12:00:00Z");
const evaluateNode = nodeEvaluator({ releases: compactIndex(index), schedule, fetchedAt: "" });

describe("providers", () => {
  it("are what the client-side labels call checked", () => {
    // labels.ts cannot import the providers (server-only), so the two lists are kept in step here.
    expect(Object.keys(PROVIDERS).sort()).toEqual([...CHECKED_RUNTIMES].sort());
    for (const p of Object.values(PROVIDERS)) expect(p.label).toBe(runtimeLabel(p.name));
  });

  it("evaluate only the runtimes they have data for", () => {
    const evaluators = new Map<string, Evaluator>([["node", evaluateNode]]);
    const out = evaluateRuntimes(
      [
        { name: "python", version: "3.12.4" },
        { name: "node", version: "22.11.0" },
      ],
      evaluators,
      now,
    );
    expect(out.map((e) => [e.runtime, e.line, e.securityUpdate?.target])).toEqual([
      ["node", "22", "22.23.4"],
    ]);
  });
});

describe("node evaluation", () => {
  it("maps Node's lifecycle onto the shared phases", () => {
    expect(evaluateNode("22.11.0", now)).toMatchObject({
      label: "Node.js",
      line: "22",
      phase: "maintenance",
      phaseLabel: "Maintenance LTS",
      codename: "Jod",
    });
    // 24 moved to maintenance on 2026-10-20; 26 becomes LTS on 2026-10-28.
    expect(evaluateNode("24.0.0", new Date("2026-06-01T00:00:00Z")).phase).toBe("active");
    expect(evaluateNode("26.0.0", now).phase).toBe("current");
    expect(evaluateNode("18.20.0", now).phase).toBe("eol");
  });

  it("describes the line", () => {
    expect(lineDescription(evaluateNode("22.11.0", now))).toMatch(
      /^Node\.js 22 · Jod · Maintenance LTS until /,
    );
    expect(lineDescription(evaluateNode("18.20.0", now))).toMatch(
      /^Node\.js 18 · Hydrogen · End-of-life since /,
    );
    expect(lineDescription(null)).toBeNull();
  });
});

describe("labels", () => {
  it("names known runtimes and passes unknown ones through", () => {
    expect(runtimeLabel("node")).toBe("Node.js");
    expect(runtimeLabel("php")).toBe("PHP");
    expect(runtimeLabel("zig")).toBe("zig");
  });

  it("pins an image only where it knows one", () => {
    expect(pinFor("node", "22.23.4", "alpine")).toBe("node:22.23.4-alpine");
    expect(pinFor("python", "3.12.8", "debian")).toBeNull();
  });

  it("leads with the first checked runtime", () => {
    const bun = { name: "bun", version: "1.2.3" };
    const node = { name: "node", version: "22.11.0" };
    expect(primaryRuntime([bun, node])).toBe(node);
    expect(primaryRuntime([bun])).toBe(bun);
    expect(primaryRuntime([])).toBeNull();
    expect(primaryRuntime(null)).toBeNull();
    expect(formatRuntimes([node, bun])).toBe("node 22.11.0 · bun 1.2.3");
  });
});

describe("diffRuntimes", () => {
  it("reports changed, added and removed runtimes", () => {
    expect(
      diffRuntimes(
        [
          { name: "node", version: "22.11.0" },
          { name: "python", version: "3.11.2" },
          { name: "bun", version: "1.2.3" },
        ],
        [
          { name: "node", version: "22.23.4" },
          { name: "bun", version: "1.2.3" },
          { name: "deno", version: "2.5.0" },
        ],
      ),
    ).toEqual([
      { name: "node", from: "22.11.0", to: "22.23.4" },
      { name: "deno", from: null, to: "2.5.0" },
      { name: "python", from: "3.11.2", to: null },
    ]);
  });
});
