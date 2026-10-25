// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import index from "./__fixtures__/index.json";
import schedule from "./__fixtures__/schedule.json";
import { compactIndex, evaluateNode, type NodeData } from "./evaluate";

const data: NodeData = { releases: compactIndex(index), schedule, fetchedAt: "2026-10-25T00:00:00Z" };
const now = new Date("2026-10-25T12:00:00Z");

describe("evaluateNode", () => {
  it("flags a missed security release and targets the newest patch in the line", () => {
    const r = evaluateNode("22.11.0", data, now);
    expect(r.phase).toBe("maintenance");
    expect(r.codename).toBe("Jod");
    expect(r.latestInLine).toBe("22.23.4");
    expect(r.securityUpdate?.target).toBe("22.23.4");
    expect(r.securityUpdate?.releases).toContain("22.23.4");
    expect(r.securityUpdate?.releases[0]).not.toBe("22.11.0");
    expect(r.patchAvailable).toBe(true);
  });

  it("is quiet for the latest patch", () => {
    const r = evaluateNode("24.22.1", data, now);
    expect(r.securityUpdate).toBeNull();
    expect(r.patchAvailable).toBe(false);
    expect(r.phase).toBe("maintenance");
  });

  it("reports end-of-life lines", () => {
    const r = evaluateNode("20.18.0", data, now);
    expect(r.phase).toBe("eol");
    expect(r.eolSoon).toBe(false);
    expect(r.daysToEol).toBeLessThan(0);
  });

  it("warns 30 days before end-of-life", () => {
    const r = evaluateNode("22.23.4", data, new Date("2027-04-10T00:00:00Z"));
    expect(r.eolSoon).toBe(true);
    expect(r.daysToEol).toBe(20);
  });

  it("knows lines that are not LTS yet", () => {
    const r = evaluateNode("26.12.1", data, now);
    expect(r.phase).toBe("current");
    expect(evaluateNode("26.12.1", data, new Date("2026-10-29T00:00:00Z")).phase).toBe("active-lts");
  });

  it("handles unknown majors", () => {
    const r = evaluateNode("99.0.0", data, now);
    expect(r.phase).toBe("unknown");
    expect(r.latestInLine).toBeNull();
    expect(r.securityUpdate).toBeNull();
  });
});
