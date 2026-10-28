// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@/lib/pb/types";
import { BADGE_COLORS, badgeSvg, badgeValue, runtimeBadge } from "./badge";

describe("badgeValue", () => {
  it("names the two worst severities and is red only from high", () => {
    expect(
      badgeValue({ status: "vulnerable", counts: { low: 3, high: 2, moderate: 10 }, runtime: null }),
    ).toEqual({ value: "2 high, 10 moderate", color: BADGE_COLORS.vulnerable });
    expect(badgeValue({ status: "vulnerable", counts: { moderate: 4 }, runtime: null })).toEqual({
      value: "4 moderate",
      color: BADGE_COLORS.update,
    });
    expect(badgeValue({ status: "vulnerable", counts: { low: 1 }, runtime: null }).color).toBe(
      BADGE_COLORS.none,
    );
  });

  it("covers runtime updates, ok and no builds", () => {
    expect(badgeValue({ status: "update", counts: {}, runtime: "node eol" })).toEqual({
      value: "node eol",
      color: BADGE_COLORS.update,
    });
    expect(badgeValue({ status: "ok", counts: {}, runtime: null }).value).toBe("ok");
    expect(badgeValue({ status: "none", counts: {}, runtime: null }).value).toBe("no builds");
  });
});

describe("runtimeBadge", () => {
  const issue = (runtime: string) => ({ data: { runtime } }) as unknown as IssueRecord;
  it("prefers a security release over end of life", () => {
    expect(runtimeBadge({ runtimeSecurity: [issue("node")], runtimeEol: [issue("python")] })).toBe(
      "node update",
    );
    expect(runtimeBadge({ runtimeSecurity: [], runtimeEol: [issue("python")] })).toBe("python eol");
    expect(runtimeBadge({ runtimeSecurity: [], runtimeEol: [] })).toBeNull();
  });
});

describe("badgeSvg", () => {
  it("escapes what it renders", () => {
    expect(badgeSvg("observator", "<b>", "#000")).toContain("&lt;b&gt;");
  });
});
