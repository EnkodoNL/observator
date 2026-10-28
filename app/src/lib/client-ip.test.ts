// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { clientIpFrom, formatAddress, inRange, parseAddress } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);
const CF = "172.71.10.20"; // inside 172.64.0.0/13
const CF6 = "2a06:98c1:3120::3"; // inside 2a06:98c0::/29

describe("parseAddress / formatAddress", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["::ffff:192.168.65.1", "192.168.65.1"],
    ["2a01:4f8:c0c:1234:0:0:0:1", "2a01:4f8:c0c:1234::1"],
    ["[2a01:4f8:c0c:1234::1]:443", "2a01:4f8:c0c:1234::1"],
    ["::1", "::1"],
    ["::", "::"],
    ["2001:db8::", "2001:db8::"],
    ["2001:0:0:1:0:0:0:1", "2001:0:0:1::1"],
  ])("%s -> %s", (raw, formatted) => {
    const a = parseAddress(raw);
    expect(a && formatAddress(a)).toBe(formatted);
  });

  it.each(["<script>", "1.2.3", "256.1.1.1", "1.2.3.4.5", "1::2::3", "12345::", "", "unknown"])(
    "refuses %j",
    (raw) => {
      expect(parseAddress(raw)).toBeNull();
    },
  );

  it("matches ranges per version", () => {
    expect(inRange(parseAddress("104.16.1.1")!, "104.16.0.0/13")).toBe(true);
    expect(inRange(parseAddress("104.24.0.1")!, "104.16.0.0/13")).toBe(false);
    expect(inRange(parseAddress("2606:4700:10::1")!, "2606:4700::/32")).toBe(true);
    expect(inRange(parseAddress("104.16.1.1")!, "2606:4700::/32")).toBe(false);
  });
});

describe("clientIpFrom", () => {
  it("trusts the entry our proxy added, not what the client sent before it", () => {
    // The client claims 10.0.0.1; Traefik appended the address it really saw.
    expect(clientIpFrom(h({ "x-forwarded-for": "10.0.0.1, 198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFrom(h({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("counts more proxies when told to", () => {
    const headers = h({ "x-forwarded-for": "10.0.0.1, 198.51.100.4, 10.1.0.2" });
    expect(clientIpFrom(headers, 2)).toBe("198.51.100.4");
    expect(clientIpFrom(headers, 9)).toBe("10.0.0.1");
  });

  describe("with TRUST_CLOUDFLARE", () => {
    const ip = (headers: Record<string, string>) => clientIpFrom(h(headers), 1, true);

    it("takes CF-Connecting-IP when the request came through Cloudflare", () => {
      // Traefik replaced the header (default) or appended to Cloudflare's (trusted IPs).
      expect(ip({ "x-forwarded-for": CF, "cf-connecting-ip": "203.0.113.9" })).toBe("203.0.113.9");
      expect(ip({ "x-forwarded-for": `203.0.113.9, ${CF}`, "cf-connecting-ip": "203.0.113.9" })).toBe(
        "203.0.113.9",
      );
      expect(ip({ "x-forwarded-for": CF6, "cf-connecting-ip": "2a01:4f8::7" })).toBe("2a01:4f8::7");
    });

    it("ignores CF-Connecting-IP from anyone who skips Cloudflare", () => {
      expect(ip({ "x-forwarded-for": "198.51.100.4", "cf-connecting-ip": "203.0.113.9" })).toBe(
        "198.51.100.4",
      );
      expect(ip({ "x-forwarded-for": `${CF}, 198.51.100.4`, "cf-connecting-ip": "203.0.113.9" })).toBe(
        "198.51.100.4",
      );
    });

    it("falls back to the Cloudflare hop when the header is missing or junk", () => {
      expect(ip({ "x-forwarded-for": CF })).toBe(CF);
      expect(ip({ "x-forwarded-for": CF, "cf-connecting-ip": "nope" })).toBe(CF);
    });
  });

  it("ignores CF-Connecting-IP without TRUST_CLOUDFLARE, even from a Cloudflare address", () => {
    // A Worker can open its own socket from Cloudflare's ranges and write the header.
    expect(clientIpFrom(h({ "x-forwarded-for": CF, "cf-connecting-ip": "203.0.113.9" }))).toBe(CF);
  });

  it("never returns junk", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "<script>" }))).toBe("unknown");
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.2" }))).toBe("unknown");
    expect(clientIpFrom(h({}))).toBe("unknown");
  });
});
