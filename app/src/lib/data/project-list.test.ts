// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "@/lib/pb/types";
import type { ProjectStatus, StatusSummary } from "@/lib/status";
import { kindOf, projectList, type ProjectListFilter } from "./project-list";
import type { ProjectSummary } from "./views";

const item = (name: string, status: ProjectStatus, fields: Partial<ProjectRecord> = {}): ProjectSummary => ({
  project: {
    id: name,
    name,
    slug: name,
    labels: [],
    buildLabels: [],
    coolifyKind: "",
    ...fields,
  } as ProjectRecord,
  latest: null,
  summary: { status } as StatusSummary,
  lastBuildAt: null,
});

const items = [
  item("web", "ok", { labels: ["app:shop"] }),
  item("api", "vulnerable", { labels: ["app:shop"] }),
  item("shop-db", "update", { coolifyKind: "database" }),
  item("stats", "ok", { coolifyKind: "service" }),
  item("cache", "none", { coolifyKind: "database" }),
];
const all: ProjectListFilter = { kind: "all", status: null, q: "", labels: [] };

describe("projectList", () => {
  it("lists every project, the ones that need work first, and counts each kind", () => {
    const { rows, counts } = projectList(items, all);
    expect(rows.map((r) => r.project.name)).toEqual(["api", "shop-db", "cache", "stats", "web"]);
    expect(counts).toEqual({ all: 5, apps: 2, databases: 2, services: 1 });
  });

  it("filters by kind, keeping the counts of the other kinds", () => {
    const { rows, counts } = projectList(items, { ...all, kind: "databases" });
    expect(rows.map((r) => r.project.name)).toEqual(["shop-db", "cache"]);
    expect(counts.apps).toBe(2);
  });

  it("filters by status, search and labels, and counts with them", () => {
    expect(projectList(items, { ...all, status: "ok" }).counts).toEqual({
      all: 2,
      apps: 1,
      databases: 0,
      services: 1,
    });
    expect(projectList(items, { ...all, q: "SHOP" }).rows.map((r) => r.project.name)).toEqual(["shop-db"]);
    expect(projectList(items, { ...all, labels: ["app:shop"] }).rows.map((r) => r.project.name)).toEqual([
      "api",
      "web",
    ]);
  });

  it("names the kind of a project", () => {
    expect(kindOf({ coolifyKind: "" })).toBe("app");
    expect(kindOf({ coolifyKind: "service" })).toBe("service");
  });
});
