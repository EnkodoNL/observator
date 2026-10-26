// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import {
  effectiveLabels,
  groupServers,
  hasLabels,
  labelKeys,
  labelValue,
  MAX_LABELS,
  parseLabels,
  sectionsByLabel,
} from "./labels";
import { worstStatus } from "./status";

describe("parseLabels", () => {
  it("splits on commas and spaces, lowercases and dedupes", () => {
    expect(parseLabels("App:Heatwave, env:prod  critical,env:prod")).toEqual({
      labels: ["app:heatwave", "env:prod", "critical"],
      invalid: [],
    });
    expect(parseLabels(["team:web/frontend", " role:worker "]).labels).toEqual([
      "team:web/frontend",
      "role:worker",
    ]);
  });

  it("returns what it cannot use", () => {
    expect(parseLabels("ok, -bad, a:b:c, bad!, :empty, " + "x".repeat(40)).invalid).toEqual([
      "-bad",
      "a:b:c",
      "bad!",
      ":empty",
      "x".repeat(40),
    ]);
  });

  it("keeps at most MAX_LABELS", () => {
    const many = Array.from({ length: MAX_LABELS + 2 }, (_, i) => `l${i}`).join(",");
    const { labels, invalid } = parseLabels(many);
    expect(labels).toHaveLength(MAX_LABELS);
    expect(invalid).toEqual([`l${MAX_LABELS}`, `l${MAX_LABELS + 1}`]);
  });
});

describe("label helpers", () => {
  it("merges own and build labels", () => {
    expect(effectiveLabels({ labels: ["env:prod", "critical"], buildLabels: ["app:x", "env:prod"] })).toEqual(
      ["app:x", "critical", "env:prod"],
    );
    expect(effectiveLabels({ labels: null, buildLabels: undefined })).toEqual([]);
  });

  it("reads values and keys", () => {
    expect(labelValue(["app:heatwave", "env:prod"], "env")).toBe("prod");
    expect(labelValue(["environment:x"], "env")).toBeNull();
    expect(
      labelKeys([
        ["app:a", "critical"],
        ["env:prod", "app:b"],
      ]),
    ).toEqual(["app", "env"]);
  });

  it("filters with AND", () => {
    expect(hasLabels(["app:a", "env:prod"], ["env:prod"])).toBe(true);
    expect(hasLabels(["app:a", "env:prod"], ["env:prod", "app:b"])).toBe(false);
    expect(hasLabels([], [])).toBe(true);
  });
});

describe("grouping", () => {
  const p = (name: string, labels: string[], server?: string) => ({ name, labels, server });

  it("sections by label value, projects without it last", () => {
    const items = [p("a", ["env:prod"]), p("b", []), p("c", ["env:dev"]), p("d", ["env:prod"])];
    const sections = sectionsByLabel(items, "env", (i) => i.labels);
    expect(sections.map((s) => [s.value, s.items.map((i) => i.name)])).toEqual([
      ["dev", ["c"]],
      ["prod", ["a", "d"]],
      [null, ["b"]],
    ]);
  });

  it("collapses the servers of one app, keeps singles", () => {
    const items = [
      p("web · 1", [], "k/web"),
      p("api", []),
      p("web · 2", [], "k/web"),
      p("worker · 1", [], "k/worker"),
    ];
    const entries = groupServers(items, (i) =>
      i.server ? { key: i.server, name: i.server.split("/")[1] } : null,
    );
    expect(
      entries.map((e) =>
        e.kind === "group" ? `${e.name}: ${e.items.map((i) => i.name).join(", ")}` : e.item.name,
      ),
    ).toEqual(["web: web · 1, web · 2", "api", "worker · 1"]);
  });

  it("takes the worst status of a group", () => {
    expect(worstStatus(["ok", "update", "ok"])).toBe("update");
    expect(worstStatus(["none", "vulnerable", "ok"])).toBe("vulnerable");
    expect(worstStatus([])).toBe("none");
  });
});
