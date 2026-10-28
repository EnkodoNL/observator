// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@/lib/data/views";
import type { BuildRecord, IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { summarize } from "./status";
import { triage } from "./triage";

const NOW = new Date();

function issue(kind: IssueRecord["kind"], severity: Severity, data: object, status = "open"): IssueRecord {
  return { kind, severity, data, status } as unknown as IssueRecord;
}

const vuln = (pkg: string, version: string, osvId: string, severity: Severity, fixedIn = "4.17.21") =>
  issue("vuln", severity, { package: pkg, version, osvId, fixedIn });

function item(name: string, issues: IssueRecord[], { built = true, lastBuildAt = NOW } = {}): ProjectSummary {
  return {
    project: { name, slug: name.toLowerCase() } as ProjectRecord,
    latest: built ? ({ runtimes: [] } as unknown as BuildRecord) : null,
    summary: summarize(built, issues),
    lastBuildAt: built ? lastBuildAt : null,
  };
}

describe("triage", () => {
  it("is empty when nothing needs doing", () => {
    expect(triage([item("Web", []), item("New", [], { built: false })], 14)).toEqual([]);
  });

  it("groups a package across projects and counts each advisory once", () => {
    const shared = [
      vuln("lodash", "4.17.20", "GHSA-1", "critical"),
      vuln("lodash", "4.17.20", "GHSA-2", "high"),
    ];
    const [cause, ...rest] = triage(
      [
        item("Web", shared),
        item("Api", shared),
        item("Worker", [vuln("lodash", "4.17.19", "GHSA-1", "high")]),
      ],
      14,
    );
    expect(rest).toEqual([]);
    expect(cause).toMatchObject({
      kind: "package",
      package: "lodash",
      severity: "critical",
      advisories: 2,
      versions: ["4.17.19", "4.17.20"],
      fixedIn: "4.17.21",
      href: "/packages/lodash",
    });
    expect(cause.projects.map((p) => p.name)).toEqual(["Api", "Web", "Worker"]);
  });

  it("drops the fixed version when advisories disagree", () => {
    const [cause] = triage(
      [item("Web", [vuln("qs", "6.0.0", "A", "high", "6.2.0"), vuln("qs", "6.0.0", "B", "low", "6.5.0")])],
      14,
    );
    expect(cause).toMatchObject({ kind: "package", fixedIn: null });
  });

  it("leaves ignored advisories out", () => {
    expect(triage([item("Web", [issue("vuln", "critical", {}, "ignored")])], 14)).toEqual([]);
  });

  it("puts critical first, then runtime security fixes, then severity and reach", () => {
    const runtime = issue("runtime_security", "moderate", {
      runtime: "node",
      running: "22.11.0",
      target: "22.23.4",
    });
    const causes = triage(
      [
        item("Web", [runtime, vuln("lodash", "4.17.20", "A", "high"), vuln("qs", "6.0.0", "B", "high")]),
        item("Api", [vuln("minimist", "1.2.5", "C", "critical"), vuln("qs", "6.0.0", "B", "high")]),
      ],
      14,
    );
    expect(causes.map((c) => (c.kind === "package" ? c.package : c.kind))).toEqual([
      "minimist",
      "runtime_security",
      "qs",
      "lodash",
    ]);
  });

  it("puts the heaviest first: severity, then reach", () => {
    const runtime = issue("runtime_security", "high", {
      runtime: "node",
      running: "22.11.0",
      target: "22.23.4",
    });
    const causes = triage(
      [
        item("Web", [runtime, vuln("qs", "6.0.0", "A", "moderate")]),
        item("Api", [vuln("lodash", "4.17.20", "B", "high"), vuln("qs", "6.0.0", "A", "moderate")]),
        item("Old", [], { lastBuildAt: new Date(NOW.getTime() - 30 * 86_400_000) }),
      ],
      14,
    );
    expect(causes.map((c) => (c.kind === "package" ? c.package : c.kind))).toEqual([
      "runtime_security",
      "lodash",
      "qs",
      "stale",
    ]);
    // One project: the cause links to it.
    expect(causes[0].href).toBe("/projects/web");
    expect(causes.at(-1)).toMatchObject({ kind: "stale", projects: [{ name: "Old", slug: "old" }] });
  });
});

describe("dev dependencies", () => {
  const dev = issue("vuln", "high", {
    package: "vite",
    version: "8.3.1",
    osvId: "GHSA-d",
    fixedIn: "8.3.3",
    dev: true,
  });
  const prod = vuln("lodash", "4.17.20", "GHSA-1", "moderate");

  it("are build-only and leave the status alone by default", () => {
    const s = summarize(true, [dev]);
    expect(s).toMatchObject({ status: "ok", vulnCount: 0, worstSeverity: null });
    expect(s.buildOnly).toEqual([dev]);
    expect(triage([item("Web", [dev])], 14)).toEqual([]);
  });

  it("count like any other advisory when the setting is on", () => {
    const s = summarize(true, [dev, prod], true);
    expect(s).toMatchObject({ status: "vulnerable", vulnCount: 2, worstSeverity: "high", buildOnly: [] });
  });

  it("do not hide production advisories in the same project", () => {
    const s = summarize(true, [dev, prod]);
    expect(s).toMatchObject({ status: "vulnerable", vulnCount: 1, worstSeverity: "moderate" });
  });
});
