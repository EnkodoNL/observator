// SPDX-License-Identifier: FSL-1.1-ALv2
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/lib/data/views";
import type { BuildRecord, IssueRecord, ProjectRecord, Severity } from "@/lib/pb/types";
import { summarize } from "./status";

const overview = vi.fn<() => Promise<ProjectSummary[]>>();
vi.mock("@/lib/data/views", () => ({ getOverview: () => overview() }));
vi.mock("@/lib/data/ingest-keys", () => ({ listIngestKeys: async () => [] }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ domainWarnDays: 30, domainUrgentDays: 7 }) }));
vi.mock("@/lib/domains/data", () => ({ listDomains: async () => [] }));

const { statusReport } = await import("./project-list");

const issue = (kind: IssueRecord["kind"], severity: Severity, data: object) =>
  ({ kind, severity, data, status: "open" }) as unknown as IssueRecord;

function item(name: string, issues: IssueRecord[], labels: string[] = []): ProjectSummary {
  return {
    project: { id: name, name, slug: name, labels } as unknown as ProjectRecord,
    latest: { runtimes: [] } as unknown as BuildRecord,
    summary: summarize(true, issues),
    lastBuildAt: new Date(),
  };
}

const crypto = (sev: Severity = "moderate") =>
  issue("vuln", sev, {
    package: "golang.org/x/crypto",
    ecosystem: "Go",
    version: "0.31.0",
    osvId: "GO-1",
    fixedIn: "0.45.0",
  });

beforeEach(() => overview.mockReset());

describe("statusReport", () => {
  it("lists one to-do per cause across projects, with absolute links", async () => {
    overview.mockResolvedValue([item("beszel-a", [crypto()]), item("beszel-b", [crypto()]), item("web", [])]);
    const report = await statusReport();
    expect(report.counts).toMatchObject({ vulnerable: 2, ok: 1 });
    expect(report.projects).toHaveLength(3);
    expect(report.todo).toHaveLength(1);
    expect(report.todo[0]).toMatchObject({
      kind: "package",
      package: "golang.org/x/crypto",
      fixedIn: "0.45.0",
      advisories: 1,
      href: "http://localhost:3000/packages/golang.org/x/crypto",
    });
    expect(report.todo[0]!.projects.map((p) => p.slug)).toEqual(["beszel-a", "beszel-b"]);
  });

  it("names runtimes and links several projects to the runtimes overview", async () => {
    const node = issue("runtime_security", "high", {
      runtime: "node",
      running: "22.11.0",
      target: "22.12.0",
      os: "",
      securityReleases: ["22.12.0"],
    });
    overview.mockResolvedValue([item("a", [node]), item("b", [node])]);
    const [cause] = (await statusReport()).todo;
    expect(cause).toMatchObject({
      kind: "runtime_security",
      label: "Node.js",
      href: "http://localhost:3000/runtimes",
    });
  });

  it("applies the label filter to projects, counts and to-dos alike", async () => {
    overview.mockResolvedValue([
      item("prod", [crypto("high")], ["env:prod"]),
      item("dev", [crypto()], ["env:dev"]),
    ]);
    const report = await statusReport({ labels: ["env:prod"] });
    expect(report.projects.map((p) => p.slug)).toEqual(["prod"]);
    expect(report.counts.vulnerable).toBe(1);
    expect(report.todo[0]!.projects.map((p) => p.slug)).toEqual(["prod"]);
  });
});
