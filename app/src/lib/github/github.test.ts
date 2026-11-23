// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { affects, fixedFor, inRange, isPatched, parseRange } from "./ranges";
import { newestIn, parseAdvisories, parseReleases } from "./repos";

describe("advisory ranges", () => {
  it("reads the ranges repositories write", () => {
    expect(inRange("2.5.7", ">= 1.0.6, <= 2.5.7")).toBe(true);
    expect(inRange("2.5.8", ">= 1.0.6, <= 2.5.7")).toBe(false);
    expect(inRange("1.39.0", "< 1.40.1")).toBe(true);
    expect(inRange("2.0.0", "<=2.0.0")).toBe(true);
    expect(inRange("3.4.0", "3.4.0")).toBe(true);
    expect(inRange("1.2.3", "v1.2.3")).toBe(true);
  });

  it("reads free text as far as it says something, and never guesses the rest", () => {
    expect(inRange("2.4.0", "current (≥ 2.3.1, latest)")).toBe(true);
    expect(inRange("2.3.0", "current (≥ 2.3.1, latest)")).toBe(false);
    expect(parseRange("all versions before the rewrite")).toBeNull();
    expect(inRange("1.0.0", "all versions before the rewrite")).toBeNull();
    expect(inRange("latest", "< 2.0.0")).toBeNull();
  });

  it("reads all versions, a hyphen range and a list of exact (pre-)releases", () => {
    expect(inRange("2.5.9", "*")).toBe(true);
    expect(inRange("1.23.10", "1.23.0 - 1.23.15")).toBe(true);
    expect(inRange("1.23.16", "1.23.0 - 1.23.15")).toBe(false);
    expect(inRange("2.5.9", "2.0.0-beta.0, 2.0.0-beta.1")).toBe(false);
    expect(inRange("2.0.0", "2.0.0, 2.0.1")).toBe(true);
  });

  it("does not report a version the advisory also names as patched", () => {
    // An upper bound of 1.19.0 next to "patched >= 0.20.0": a typo for 0.19.0.
    const vulnerable = ">= 0.9.0, <= 1.19.0";
    const patched = ">= 0.20.0";
    expect(affects("0.21.1", vulnerable, patched)).toBe("contradicts");
    expect(affects("0.19.0", vulnerable, patched)).toBe("affected");
    expect(fixedFor("0.19.0", patched)).toBe("0.20.0");
    expect(affects("0.8.0", vulnerable, patched)).toBe("unaffected");
  });

  it("reads a bare patched version as the start of the fixed releases of an open range", () => {
    // GitHub's usual shape: an affected range without an upper bound, and the first fix.
    expect(affects("2.10.13", ">= 2.9.0b12", "2.10.6")).toBe("unaffected");
    expect(affects("2.10.6", ">= 2.9.0b12", "2.10.6")).toBe("unaffected");
    expect(affects("2.10.5", ">= 2.9.0b12", "2.10.6")).toBe("affected");
    expect(fixedFor("2.10.5", "2.10.6")).toBe("2.10.6");
    expect(affects("2.5.9", ">= 1.23.0", "2.2.1")).toBe("unaffected");
    expect(affects("2.5.9", ">= 2.0.0", "2.5.9")).toBe("unaffected");
    expect(affects("2.5.8", ">= 2.0.0", "2.5.9")).toBe("affected");
    expect(affects("3.1.0", "*", "3.0.0")).toBe("unaffected");
    expect(affects("2.9.9", "*", "3.0.0")).toBe("affected");
    expect(affects("2.5.9", "> 2.0.0", "2.5.9")).toBe("unaffected");
  });

  it("reads each version in a patched list as the start of the fixes in its own line", () => {
    const patched = "1.23.17, 2.0.1";
    expect(isPatched("1.23.16", patched)).toBe(false);
    expect(isPatched("1.23.17", patched)).toBe(true);
    expect(isPatched("1.23.18", patched)).toBe(true);
    expect(isPatched("2.0.0", patched)).toBe(false);
    expect(isPatched("2.0.1", patched)).toBe(true);
    expect(isPatched("3.0.0", patched)).toBe(true);
    expect(isPatched("2.0.0", "2.0.1, 1.23.17")).toBe(false);
    expect(affects("2.0.0", ">= 1.0.0", patched)).toBe("affected");
    expect(fixedFor("2.0.0", patched)).toBe("2.0.1");
    expect(affects("1.23.18", ">= 1.0.0", patched)).toBe("unaffected");
    expect(affects("3.0.0", ">= 1.0.0", patched)).toBe("unaffected");
  });

  it("lets a patched pre-release patch only itself, never a stable version", () => {
    expect(isPatched("2.0.0", "2.0.0-beta.0, 2.0.0-beta.1")).toBe(false);
    expect(isPatched("2.1.0", "2.0.0-beta.1")).toBe(false);
    // It still ends the line before it: 1.23.17 does not reach into 2.x.
    expect(isPatched("1.23.18", "1.23.17, 2.0.0-beta.1")).toBe(true);
    expect(isPatched("1.24.0", "1.23.17, 2.0.0-beta.1")).toBe(false);
    expect(isPatched("2.0.0", "1.23.17, 2.0.0-beta.1")).toBe(false);
    expect(isPatched("2.0.1", "2.0.0-beta.1, 2.0.0")).toBe(true);
  });

  it("calls a bounded range that overlaps its own patched versions a contradiction", () => {
    expect(affects("2.5.9", ">= 2.0.0, <= 2.5.9", "2.5.9")).toBe("contradicts");
    expect(affects("1.5.0", "1.0.0 - 2.0.0", "1.4.0")).toBe("contradicts");
    expect(affects("1.3.0", "1.0.0 - 2.0.0", "1.4.0")).toBe("affected");
    expect(affects("2.0.0", "2.0.0, 2.0.1", "2.0.2")).toBe("affected");
  });

  it("never takes an empty or unreadable patched field as patched", () => {
    expect(affects("2.5.8", "< 2.5.9", "")).toBe("affected");
    expect(affects("2.5.8", "< 2.5.9", "the next release")).toBe("affected");
    expect(affects("1.0.0", "all versions before the rewrite", ">= 0.1.0")).toBe("unclear");
    expect(affects("3.0.0", ">= 2.0.0", "the next release")).toBe("affected");
    expect(isPatched("2.5.9", "")).toBe(false);
    expect(isPatched("latest", "2.5.9")).toBe(false);
  });

  it("takes the lowest patched version above the running one", () => {
    expect(fixedFor("2.5.7", "2.5.9")).toBe("2.5.9");
    expect(fixedFor("1.23.0", "2.0.1, 1.23.17")).toBe("1.23.17");
    expect(fixedFor("3.0.0", "2.5.9")).toBe("");
    expect(fixedFor("1.0.0", "")).toBe("");
  });
});

describe("repository data", () => {
  it("keeps stable releases with a version, newest first, and finds the newest in a line", () => {
    const releases = parseReleases([
      { tag_name: "v1.9.0", published_at: "2026-01-01T00:00:00Z" },
      { tag_name: "2.0.0-beta.1", prerelease: true },
      { tag_name: "app-1.10.2", published_at: "2026-02-01T00:00:00Z" },
      { tag_name: "nightly", published_at: "2026-03-01T00:00:00Z" },
      { tag_name: "v2.1.0", draft: true },
    ]);
    expect(releases.map((r) => r.version)).toEqual(["1.10.2", "1.9.0"]);
    expect(newestIn(releases, "1")?.version).toBe("1.10.2");
    expect(newestIn(releases, "1.9")?.version).toBe("1.9.0");
    expect(newestIn(releases, "2")).toBeNull();
    expect(newestIn(releases, null)?.version).toBe("1.10.2");
  });

  it("reads published advisories, one per affected range", () => {
    const advisories = parseAdvisories([
      {
        ghsa_id: "GHSA-aaaa-bbbb-cccc",
        cve_id: "CVE-2026-0001",
        severity: "medium",
        summary: "Header injection",
        html_url: "https://github.com/example/app/security/advisories/GHSA-aaaa-bbbb-cccc",
        updated_at: "2026-11-01T00:00:00Z",
        vulnerabilities: [
          { vulnerable_version_range: ">= 2.1.0, <= 2.5.8", patched_versions: "2.5.9" },
          { vulnerable_version_range: "< 1.23.17", patched_versions: "1.23.17" },
        ],
      },
      { ghsa_id: "GHSA-dddd-eeee-ffff", severity: "critical", withdrawn_at: "2026-10-01T00:00:00Z" },
      { ghsa_id: "not-an-id" },
    ]);
    expect(advisories).toHaveLength(2);
    expect(advisories[0]).toMatchObject({
      id: "GHSA-aaaa-bbbb-cccc",
      cve: "CVE-2026-0001",
      severity: "moderate",
    });
    expect(advisories.map((a) => a.patched)).toEqual(["2.5.9", "1.23.17"]);
  });
});
