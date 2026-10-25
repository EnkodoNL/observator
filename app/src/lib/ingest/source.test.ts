// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { IngestError } from "./request";
import { displayName, reportedName } from "./source";

describe("reportedName", () => {
  it("prefers OBSERVATOR_PROJECT, then package.json", () => {
    expect(reportedName(" billing-api ", { name: "app" })).toBe("billing-api");
    expect(reportedName("", { name: "@acme/web" })).toBe("@acme/web");
    expect(reportedName(null, { name: "web" })).toBe("web");
  });

  it("refuses reports without a usable name", () => {
    expect(() => reportedName(null, {})).toThrow(/OBSERVATOR_PROJECT/);
    expect(() => reportedName(null, null)).toThrow(IngestError);
    expect(() => reportedName("x".repeat(101), null)).toThrow(/1-100/);
    expect(() => reportedName("naïve", null)).toThrow(/ASCII/);
  });
});

describe("displayName", () => {
  it("adds the server when projects are split by IP", () => {
    expect(displayName("api", "")).toBe("api");
    expect(displayName("api", "203.0.113.7")).toBe("api · 203.0.113.7");
  });
});
