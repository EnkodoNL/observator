// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { rateKey } from "./client-ip";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows a burst, then refills over the window", () => {
    let now = 0;
    const l = RateLimiter.perWindow(2, 1000, () => now);
    expect([l.take("a"), l.take("a"), l.take("a")]).toEqual([true, true, false]);
    now = 500;
    expect(l.take("a")).toBe(true);
  });

  it("stays at its cap under a flood of new keys, keeping the recent ones", () => {
    let now = 0;
    const l = RateLimiter.perWindow(1, 60_000, () => now);
    l.take("victim");
    for (let i = 0; i < 25_000; i++) {
      now++;
      l.take(`flood-${i}`);
      if (i % 1000 === 0) l.take("victim");
    }
    expect(l.size).toBeLessThanOrEqual(10_000);
    expect(l.take("victim")).toBe(false);
  });
});

describe("rateKey", () => {
  it("groups IPv6 per /64 and leaves IPv4 alone", () => {
    expect(rateKey("2a01:4f8:c2c:9793::1")).toBe(rateKey("2a01:4f8:c2c:9793:dead:beef:1:2"));
    expect(rateKey("2a01:4f8:c2c:9793::1")).toBe("2a01:4f8:c2c:9793::/64");
    expect(rateKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateKey("unknown")).toBe("unknown");
  });
});
