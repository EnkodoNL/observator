// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { RegistrationInfo } from "@/lib/pb/types";
import { registrationDue } from "./check";

const now = new Date("2026-10-29T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
const info = (checkedDaysAgo: number, extra: Partial<RegistrationInfo> = {}): RegistrationInfo => ({
  expiresAt: ahead(300),
  source: "rdap",
  checkedAt: ago(checkedDaysAgo),
  ...extra,
});

describe("registrationDue", () => {
  it("asks once a week for a far-off date, daily within two months", () => {
    expect(registrationDue(null, now)).toBe(true);
    expect(registrationDue(info(3), now)).toBe(false);
    expect(registrationDue(info(7), now)).toBe(true);
    expect(registrationDue(info(1.5, { expiresAt: ahead(40) }), now)).toBe(true);
    expect(registrationDue(info(0.5, { expiresAt: ahead(40) }), now)).toBe(false);
  });

  it("retries a failed lookup after a day, and a registry without dates weekly", () => {
    expect(registrationDue(info(0.5, { source: "failed" }), now)).toBe(false);
    expect(registrationDue(info(1, { source: "failed" }), now)).toBe(true);
    expect(registrationDue(info(3, { source: "unpublished", expiresAt: null }), now)).toBe(false);
    expect(registrationDue(info(8, { source: "unpublished", expiresAt: null }), now)).toBe(true);
  });
});
