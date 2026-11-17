// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { compareVersions, cycleFor, evaluateEol, type EolCycle, type EolData } from "./evaluate";
import cycles from "./__fixtures__/mariadb.json";

// Trimmed from https://endoflife.date/api/mariadb.json on 17 Nov 2026.
const data: EolData = { product: "mariadb", cycles: cycles as EolCycle[], fetchedAt: "2026-11-17T00:00:00Z" };
const now = new Date("2026-11-17T12:00:00Z");
const evaluate = (version: string, at = now) => evaluateEol("mariadb", "MariaDB", version, data, at);

describe("cycleFor", () => {
  it("finds the line of a version, and the newest line under a bare major", () => {
    expect(cycleFor("11.8.9", data.cycles)).toMatchObject({ cycle: { cycle: "11.8" }, versionKnown: true });
    expect(cycleFor("11.8", data.cycles)).toMatchObject({ cycle: { cycle: "11.8" }, versionKnown: false });
    expect(cycleFor("11", data.cycles)).toMatchObject({ cycle: { cycle: "11.8" }, versionKnown: false });
    expect(cycleFor("12", data.cycles)).toMatchObject({ cycle: { cycle: "12.3" }, versionKnown: false });
    expect(cycleFor("9.1.2", data.cycles)).toBeNull();
    expect(cycleFor("latest", data.cycles)).toBeNull();
  });

  it("compares versions by number, not by text", () => {
    expect(compareVersions("11.8.10", "11.8.9")).toBeGreaterThan(0);
    expect(compareVersions("v11.8.9", "11.8.9")).toBe(0);
  });
});

describe("evaluateEol", () => {
  it("offers a newer patch of a pinned version, without calling it a security release", () => {
    const e = evaluate("11.8.9");
    expect(e).toMatchObject({
      runtime: "mariadb",
      line: "11.8",
      phase: "active",
      phaseLabel: "LTS",
      latestInLine: "11.8.10",
      patchAvailable: true,
      versionKnown: true,
      securityUpdate: { target: "11.8.10", releases: [] },
    });
    expect(evaluate("11.8.10")).toMatchObject({ patchAvailable: false, securityUpdate: null });
  });

  it("checks only the line of a moving tag, never claiming the latest patch", () => {
    const e = evaluate("11");
    expect(e).toMatchObject({
      line: "11.8",
      versionKnown: false,
      patchAvailable: false,
      securityUpdate: null,
    });
    expect(e.end).toBe("2028-06-04");
  });

  it("says end of life, and warns 30 days ahead", () => {
    expect(evaluate("10.5.29")).toMatchObject({ phase: "eol", phaseLabel: "End-of-life", eolSoon: false });
    // 10.6 ends on 6 July 2026: a month before, it is a warning.
    expect(evaluate("10.6.28", new Date("2026-06-20T00:00:00Z"))).toMatchObject({
      phase: "active",
      eolSoon: true,
    });
    expect(evaluate("13.0.2")).toMatchObject({ phase: "current", phaseLabel: "Supported" });
  });

  it("points to the newest supported LTS for advice, and knows nothing of an unknown line", () => {
    expect(evaluate("10.5.29").latestSupported).toBe("12.3.4");
    expect(evaluate("9.1.2")).toMatchObject({ phase: "unknown", versionKnown: false, latestInLine: null });
  });
});
