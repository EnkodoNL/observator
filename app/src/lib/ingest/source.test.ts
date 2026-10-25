// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { IngestError } from "./request";
import { displayName, reportedName, sourceIp } from "./source";

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

describe("sourceIp", () => {
  it("takes the first forwarded address and unwraps IPv4-mapped IPv6", () => {
    expect(sourceIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(sourceIp(new Headers({ "x-forwarded-for": "::ffff:192.168.65.1" }))).toBe("192.168.65.1");
    expect(sourceIp(new Headers({ "x-forwarded-for": "2a01:4f8:c0c:1234::1" }))).toBe("2a01:4f8:c0c:1234::1");
    expect(sourceIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
  });

  it("never stores junk", () => {
    expect(sourceIp(new Headers({ "x-forwarded-for": "<script>" }))).toBe("unknown");
    expect(sourceIp(new Headers())).toBe("unknown");
  });
});

describe("displayName", () => {
  it("adds the server when projects are split by IP", () => {
    expect(displayName("api", "")).toBe("api");
    expect(displayName("api", "203.0.113.7")).toBe("api · 203.0.113.7");
  });
});
