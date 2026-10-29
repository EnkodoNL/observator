// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { CertInfo } from "@/lib/pb/types";
import { certPhase, nextAlert, registrationPhase } from "./phase";

const now = new Date("2026-10-29T12:00:00Z");
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const limits = { warnDays: 30, urgentDays: 7 };
const reg = (expiresAt: string | null, extra: { remindDays?: number; manualExpiresAt?: string } = {}) => ({
  manualExpiresAt: extra.manualExpiresAt ?? "",
  remindDays: extra.remindDays ?? 0,
  registration: { expiresAt, source: "rdap" as const, checkedAt: "" },
});

describe("registrationPhase", () => {
  it.each([
    [200, "ok"],
    [30, "warn"],
    [7, "urgent"],
    [-1, "expired"],
  ] as const)("%i days left is %s", (days, phase) => {
    expect(registrationPhase(reg(inDays(days)), limits, now)).toBe(phase);
  });

  it("reminds before the warning when the reminder is further out", () => {
    expect(registrationPhase(reg(inDays(50), { remindDays: 60 }), limits, now)).toBe("remind");
    expect(registrationPhase(reg(inDays(70), { remindDays: 60 }), limits, now)).toBe("ok");
  });

  it("takes the date entered by hand over the registry's, and has no phase without either", () => {
    expect(registrationPhase(reg(null, { manualExpiresAt: inDays(5) }), limits, now)).toBe("urgent");
    expect(registrationPhase(reg(inDays(400), { manualExpiresAt: inDays(20) }), limits, now)).toBe("warn");
    expect(registrationPhase(reg(null), limits, now)).toBeNull();
  });
});

describe("certPhase", () => {
  const cert = (from: number, to: number, extra: Partial<CertInfo> = {}): CertInfo => ({
    validFrom: inDays(from),
    expiresAt: inDays(to),
    issuer: "R11",
    error: "",
    unreachable: "",
    checkedAt: now.toISOString(),
    ...extra,
  });

  it("warns once less than a third of the lifetime is left, whatever the lifetime", () => {
    expect(certPhase(cert(-60, 30), now)).toBe("ok"); // 90-day certificate, 30 left: renewal due now
    expect(certPhase(cert(-65, 25), now)).toBe("warn");
    expect(certPhase(cert(-20, 25), now)).toBe("ok"); // 45-day certificate, 25 left
    expect(certPhase(cert(-35, 10), now)).toBe("warn");
    expect(certPhase(cert(-40, 5), now)).toBe("urgent");
  });

  it("is urgent at once when invalid, expired when expired, and says nothing when unreachable", () => {
    expect(certPhase(cert(-10, 50, { error: "ERR_TLS_CERT_ALTNAME_INVALID" }), now)).toBe("urgent");
    expect(certPhase(cert(-100, -1, { error: "CERT_HAS_EXPIRED" }), now)).toBe("expired");
    expect(certPhase(cert(-10, 50, { unreachable: "ECONNREFUSED" }), now)).toBeNull();
    expect(certPhase(null, now)).toBeNull();
  });
});

describe("nextAlert", () => {
  it("notifies when the phase gets worse, once per phase", () => {
    const first = nextAlert(null, "remind");
    expect(first).toEqual({ alert: { phase: "remind", notifiedPhase: "remind" }, notify: true });
    expect(nextAlert(first.alert, "remind").notify).toBe(false);
    expect(nextAlert(first.alert, "warn")).toMatchObject({ notify: true, alert: { notifiedPhase: "warn" } });
  });

  it("starts over after a renewal, and leaves the state alone without a verdict", () => {
    const warned = { phase: "warn" as const, notifiedPhase: "warn" as const };
    expect(nextAlert(warned, "ok")).toEqual({ alert: { phase: "ok", notifiedPhase: "ok" }, notify: false });
    expect(nextAlert(warned, null)).toEqual({ alert: warned, notify: false });
    expect(nextAlert(warned, "remind")).toEqual({
      alert: { phase: "remind", notifiedPhase: "warn" },
      notify: false,
    });
  });
});
