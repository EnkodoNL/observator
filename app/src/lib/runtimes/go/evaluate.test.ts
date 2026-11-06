// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  affects,
  compactReleases,
  compactStdlib,
  compareGo,
  goEvaluator,
  lineStarts,
  parseGo,
  type GoData,
} from "./evaluate";

// Trimmed from go.dev/dl (?mode=json&include=all), go.dev/doc/devel/release and OSV on 6 Nov 2026.
const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const data: GoData = {
  ...compactReleases(JSON.parse(fixture("releases.json"))),
  lineStart: lineStarts(fixture("release-history.html")),
  stdlib: compactStdlib(JSON.parse(fixture("osv-stdlib.json")).vulns),
  fetchedAt: "2026-11-06T00:00:00Z",
};
const evaluate = goEvaluator(data);
const NOW = new Date("2026-11-06T12:00:00Z");

describe("Go versions", () => {
  it("reads releases, first releases of a line and candidates", () => {
    expect(parseGo("1.26.2")).toEqual({ minor: 26, patch: 2, pre: "" });
    expect(parseGo("go1.20")).toEqual({ minor: 20, patch: 0, pre: "" });
    expect(parseGo("1.27rc3")).toEqual({ minor: 27, patch: 0, pre: "rc3" });
    expect(parseGo("1.27.0-0")).toEqual({ minor: 27, patch: 0, pre: "" });
    expect(parseGo("2.0.0")).toBeNull();
    expect(["1.26.10", "1.27rc1", "1.26.2", "1.27.0", "1.20"].sort(compareGo)).toEqual([
      "1.20",
      "1.26.2",
      "1.26.10",
      "1.27rc1",
      "1.27.0",
    ]);
  });

  it("knows the supported lines and when each started", () => {
    expect(data.stableLines.slice(0, 2)).toEqual(["1.27", "1.26"]);
    expect(data.lineStart).toMatchObject({
      "1.27": "2026-08-19",
      "1.26": "2026-02-10",
      "1.24": "2025-02-11",
    });
  });

  it("reads OSV ranges with an open start and a second line", () => {
    const [advisory] = data.stdlib;
    expect(affects(advisory, "1.26.2")).toBe(true);
    expect(affects(advisory, "1.26.9")).toBe(false);
    expect(affects(advisory, "1.27.1")).toBe(true);
    expect(affects(advisory, "1.27.2")).toBe(false);
  });
});

describe("goEvaluator", () => {
  it("finds the security update in a supported line", () => {
    expect(evaluate("1.26.2", NOW)).toMatchObject({
      runtime: "go",
      line: "1.26",
      phase: "active",
      phaseLabel: "Supported",
      end: null,
      latestInLine: "1.26.10",
      securityUpdate: { target: "1.26.10", releases: ["1.26.9", "1.26.10"] },
      latestSupported: "1.27.3",
    });
  });

  it("calls the newest line current and leaves a patched version alone", () => {
    expect(evaluate("1.27.3", NOW)).toMatchObject({
      phase: "current",
      securityUpdate: null,
      patchAvailable: false,
    });
  });

  it("dates the end of an old line by the release that ended it", () => {
    // 1.25 lost support when 1.27.0 came out.
    expect(evaluate("1.25.14", NOW)).toMatchObject({
      phase: "eol",
      end: "2026-08-19",
      phaseLabel: "End-of-life",
    });
    expect(evaluate("1.20", NOW)).toMatchObject({ phase: "eol", end: "2024-02-06", latestInLine: "1.20.14" });
  });

  it("does not judge a release candidate or an unknown version", () => {
    expect(evaluate("1.27rc2", NOW)).toMatchObject({ phase: "unknown", securityUpdate: null });
    expect(evaluate("1.99.0", NOW)).toMatchObject({ phase: "unknown" });
  });
});
