// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { displayEntry, formatAllowlist, matchEntry, overlaps, parseAllowlist } from "./allowlist";

describe("parseAllowlist", () => {
  it("normalizes addresses and ranges, skips comments and duplicates", () => {
    const { entries, errors } = parseAllowlist(`
      # Hetzner, Coolify servers
      198.51.100.4
      198.51.100.4/32   # same one again
      203.0.113.77/24
      2a01:4f8:c0c:1234::1
      2a01:4f8:c0c::/48
      ::ffff:192.0.2.9
    `);
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.cidr)).toEqual([
      "198.51.100.4/32",
      "203.0.113.0/24",
      "2a01:4f8:c0c:1234::1/128",
      "2a01:4f8:c0c::/48",
      "192.0.2.9/32",
    ]);
  });

  it("keeps a note per entry and writes it back as a comment", () => {
    const { entries } = parseAllowlist(
      "198.51.100.4  # coolify-1\n203.0.113.0/24 # office # wifi\n2a01:4f8::1",
    );
    expect(entries).toEqual([
      { cidr: "198.51.100.4/32", note: "coolify-1" },
      { cidr: "203.0.113.0/24", note: "office # wifi" },
      { cidr: "2a01:4f8::1/128", note: "" },
    ]);
    expect(formatAllowlist(entries)).toBe(
      "198.51.100.4  # coolify-1\n203.0.113.0/24  # office # wifi\n2a01:4f8::1",
    );
    expect(parseAllowlist(formatAllowlist(entries)).entries).toEqual(entries);
  });

  it("explains what is wrong, per line", () => {
    const { errors } = parseAllowlist(
      "198.51.100.4\nexample.com\n10.0.0.0/4\n2a01::/16\n1.2.3.4/33\n1.2.3.4/x",
    );
    expect(errors).toEqual([
      "Line 2: “example.com” is not an address or range.",
      "Line 3: “10.0.0.0/4” is too broad (at least /8).",
      "Line 4: “2a01::/16” is too broad (at least /32).",
      "Line 5: “1.2.3.4/33” has an invalid prefix.",
      "Line 6: “1.2.3.4/x” has an invalid prefix.",
    ]);
  });

  it("asks for a prefix when an IPv6 subnet is written as a single address", () => {
    expect(parseAllowlist("2a01:4f8:c2c:9793::").errors).toEqual([
      "Line 1: “2a01:4f8:c2c:9793::” is only the single address ending in zeros; for the server's whole subnet write 2a01:4f8:c2c:9793::/64 (or 2a01:4f8:c2c:9793::/128 for just this address).",
    ]);
    expect(parseAllowlist("2a01:4f8:c2c:9793::/64").entries).toEqual([
      { cidr: "2a01:4f8:c2c:9793::/64", note: "" },
    ]);
    expect(parseAllowlist("2a01:4f8:c2c:9793::/128").entries).toEqual([
      { cidr: "2a01:4f8:c2c:9793::/128", note: "" },
    ]);
    expect(parseAllowlist("2a01:4f8:c2c:9793::1").errors).toEqual([]);
  });

  it("caps the number of entries", () => {
    const text = Array.from({ length: 51 }, (_, i) => `198.51.100.${i}`).join("\n");
    expect(parseAllowlist(text).errors).toEqual(["At most 50 addresses or ranges."]);
  });
});

describe("matchEntry", () => {
  const entries = ["203.0.113.0/24", "203.0.113.7/32", "2a01:4f8:c0c::/48"];

  it("returns the most specific entry", () => {
    expect(matchEntry("203.0.113.7", entries)).toBe("203.0.113.7/32");
    expect(matchEntry("203.0.113.8", entries)).toBe("203.0.113.0/24");
    expect(matchEntry("2a01:4f8:c0c:99::5", entries)).toBe("2a01:4f8:c0c::/48");
  });

  it("matches nothing else", () => {
    expect(matchEntry("203.0.114.1", entries)).toBeNull();
    expect(matchEntry("unknown", entries)).toBeNull();
    expect(matchEntry("203.0.113.7", [])).toBeNull();
  });
});

describe("overlaps / displayEntry", () => {
  it("sees containment both ways, never across versions", () => {
    expect(overlaps("203.0.113.0/24", "203.0.113.7/32")).toBe(true);
    expect(overlaps("203.0.113.7/32", "203.0.113.0/24")).toBe(true);
    expect(overlaps("203.0.113.0/25", "203.0.113.128/25")).toBe(false);
    expect(overlaps("192.0.2.0/24", "2a01:4f8::/32")).toBe(false);
  });

  it("shows single addresses without their prefix", () => {
    expect(displayEntry("198.51.100.4/32")).toBe("198.51.100.4");
    expect(displayEntry("2a01:4f8::1/128")).toBe("2a01:4f8::1");
    expect(displayEntry("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(displayEntry("2a01:4f8::/32")).toBe("2a01:4f8::/32");
    expect(displayEntry("2a01:4f8:c2c:9793::/128")).toBe("2a01:4f8:c2c:9793::/128");
    const saved = parseAllowlist("2a01:4f8:c2c:9793::/128").entries;
    expect(parseAllowlist(formatAllowlist(saved))).toEqual({ entries: saved, errors: [] });
  });
});
