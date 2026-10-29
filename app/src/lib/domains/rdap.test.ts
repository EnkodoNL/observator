// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { parseRdap, rdapBase } from "./rdap";

const services: [string[], string[]][] = [
  [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
  [
    ["dev", "app"],
    ["http://insecure.example/", "https://pubapi.registry.google/rdap"],
  ],
  [["nl"], ["https://rdap.sidn.nl/"]],
];

describe("rdapBase", () => {
  it("finds the server for the TLD, prefers https and ends in a slash", () => {
    expect(rdapBase(services, "example.com")).toBe("https://rdap.verisign.com/com/v1/");
    expect(rdapBase(services, "enkodo.dev")).toBe("https://pubapi.registry.google/rdap/");
    expect(rdapBase(services, "dnsbelgium.be")).toBeNull();
  });
});

describe("parseRdap", () => {
  it("reads the expiration event", () => {
    const body = {
      events: [
        { eventAction: "registration", eventDate: "2020-09-21T14:30:36Z" },
        { eventAction: "expiration", eventDate: "2027-09-21T14:30:36.792Z" },
      ],
    };
    expect(parseRdap(body)).toEqual({ expiresAt: "2027-09-21T14:30:36.792Z", rateLimited: false });
  });

  it("has no date when the registry publishes none, as SIDN does", () => {
    expect(
      parseRdap({ events: [{ eventAction: "last changed", eventDate: "2026-01-01T00:00:00Z" }] }),
    ).toEqual({
      expiresAt: null,
      rateLimited: false,
    });
  });

  it("recognises a rate limit sent as HTTP 200", () => {
    expect(parseRdap({ errorCode: 429, title: "Ratelimit exceeded" }).rateLimited).toBe(true);
  });
});
