// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { parseName, parseNames } from "./names";

describe("parseName", () => {
  it.each([
    ["app.example.com", "app.example.com", "example.com"],
    ["example.com", "example.com", "example.com"],
    ["https://App.Example.com/path?x=1", "app.example.com", "example.com"],
    ["a.foo.co.uk", "a.foo.co.uk", "foo.co.uk"],
    ["shop.bücher.de", "shop.xn--bcher-kva.de", "xn--bcher-kva.de"],
    ["my-app.vercel.app", "my-app.vercel.app", "vercel.app"],
    ["example.net.", "example.net", "example.net"],
    ["www.example.org", "www.example.org", "example.org"],
  ])("%s -> host %s, domain %s", (input, host, domain) => {
    expect(parseName(input)).toEqual({ host, domain });
  });

  it.each([
    "co.uk",
    "localhost",
    "192.0.2.1",
    "[2001:db8::1]",
    "not a name",
    "",
    "-bad-.com",
    // Wildcard DNS: they only point at an IP, as Coolify's default names do.
    "abc123def456ghi789jkl012.203.0.113.7.sslip.io",
    "sslip.io",
    "app.192-0-2-1.nip.io",
    "https://demo.traefik.me/",
  ])("refuses %j", (input) => {
    expect(parseName(input)).toBeNull();
  });
});

describe("parseNames", () => {
  it("splits, dedupes and keeps the refusals apart", () => {
    expect(parseNames("a.example.com, A.example.com b.example.com nope")).toEqual({
      names: [
        { host: "a.example.com", domain: "example.com" },
        { host: "b.example.com", domain: "example.com" },
      ],
      invalid: ["nope"],
    });
  });
});
