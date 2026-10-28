// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { effectiveLabels, hasLabels, labelValue, MAX_LABELS, parseLabels } from "./labels";
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

  it("reads values", () => {
    expect(labelValue(["app:heatwave", "env:prod"], "env")).toBe("prod");
    expect(labelValue(["environment:x"], "env")).toBeNull();
  });

  it("filters with AND", () => {
    expect(hasLabels(["app:a", "env:prod"], ["env:prod"])).toBe(true);
    expect(hasLabels(["app:a", "env:prod"], ["env:prod", "app:b"])).toBe(false);
    expect(hasLabels([], [])).toBe(true);
  });
});

describe("status", () => {
  it("takes the worst status of a group", () => {
    expect(worstStatus(["ok", "update", "ok"])).toBe("update");
    expect(worstStatus(["none", "vulnerable", "ok"])).toBe("vulnerable");
    expect(worstStatus([])).toBe("none");
  });
});
