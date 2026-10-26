// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixedIn } from "./fixed";
import { cvss3BaseScore, osvSeverity, severityFromScore } from "./severity";
import type { OsvVuln } from "./types";

const load = (id: string): OsvVuln =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", `${id}.json`), "utf8"));

describe("cvss3BaseScore", () => {
  it.each([
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    ["CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H", 7.2],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N", 6.1],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L", 5.3],
    ["CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:L", 5.0],
    ["CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", 8.8],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0],
  ])("%s = %d", (vector, score) => {
    expect(cvss3BaseScore(vector)).toBe(score);
  });

  it("rejects other versions and garbage", () => {
    expect(cvss3BaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N")).toBeNull();
    expect(cvss3BaseScore("nonsense")).toBeNull();
  });

  it("maps scores to ratings", () => {
    expect([9.8, 7, 6.9, 4, 0.1, 0].map(severityFromScore)).toEqual([
      "critical",
      "high",
      "moderate",
      "moderate",
      "low",
      "unknown",
    ]);
  });
});

describe("osvSeverity", () => {
  it("prefers the GHSA rating", () => {
    expect(osvSeverity(load("GHSA-xvch-5gv4-984h"))).toBe("critical");
    expect(osvSeverity(load("GHSA-35jh-r3h4-6jhm"))).toBe("high");
    expect(osvSeverity(load("GHSA-29mw-wpgm-hmr9"))).toBe("moderate");
    expect(osvSeverity(load("GHSA-qw6h-vgh9-j6wx"))).toBe("low");
  });

  it("falls back to CVSS v3", () => {
    const v = { ...load("GHSA-35jh-r3h4-6jhm"), database_specific: {} };
    expect(osvSeverity(v)).toBe("high");
    expect(osvSeverity({ id: "X" })).toBe("unknown");
  });
});

describe("fixedIn", () => {
  it("picks the fix of the range that contains the installed version", () => {
    expect(
      fixedIn(load("GHSA-qw6h-vgh9-j6wx"), { ecosystem: "npm", name: "express", version: "4.17.1" }),
    ).toBe("4.20.0");
    expect(
      fixedIn(load("GHSA-qw6h-vgh9-j6wx"), { ecosystem: "npm", name: "express", version: "5.0.0-beta.1" }),
    ).toBe("5.0.0");
    expect(
      fixedIn(load("GHSA-xvch-5gv4-984h"), { ecosystem: "npm", name: "minimist", version: "1.2.5" }),
    ).toBe("1.2.6");
    expect(
      fixedIn(load("GHSA-xvch-5gv4-984h"), { ecosystem: "npm", name: "minimist", version: "0.0.8" }),
    ).toBe("0.2.4");
    expect(
      fixedIn(load("GHSA-35jh-r3h4-6jhm"), { ecosystem: "npm", name: "lodash", version: "4.17.20" }),
    ).toBe("4.17.21");
  });

  it("only uses ranges for the package's own ecosystem", () => {
    expect(
      fixedIn(load("GHSA-35jh-r3h4-6jhm"), { ecosystem: "PyPI", name: "lodash", version: "4.17.20" }),
    ).toBe("");
  });

  it("returns nothing when only last_affected is known", () => {
    expect(
      fixedIn(load("GHSA-35jh-r3h4-6jhm"), { ecosystem: "npm", name: "lodash.template", version: "4.5.0" }),
    ).toBe("");
  });
});
