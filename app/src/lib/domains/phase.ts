// SPDX-License-Identifier: FSL-1.1-ALv2
import type { AlertState, CertInfo, DomainRecord, ExpiryPhase, HostRecord } from "@/lib/pb/types";

const DAY = 86_400_000;

export const PHASE_RANK: Record<ExpiryPhase, number> = { ok: 0, remind: 1, warn: 2, urgent: 3, expired: 4 };

export const worse = (a: ExpiryPhase, b: ExpiryPhase) => PHASE_RANK[a] > PHASE_RANK[b];

/** Whole days from now until `date`, rounded down; negative once it has passed. */
export const daysUntil = (date: string | Date, now: Date) =>
  Math.floor((new Date(date).getTime() - now.getTime()) / DAY);

/** The registration's expiry: the date entered by hand wins over the registry's. */
export function registrationExpiry(d: Pick<DomainRecord, "manualExpiresAt" | "registration">): string | null {
  return d.manualExpiresAt || d.registration?.expiresAt || null;
}

/**
 * Where a registration stands. Null without a date (a registry that publishes none, and nothing
 * entered): no phase is better than a guess. The reminder of one's own comes before the warning
 * when it is set further out, such as moving registrar before the renewal.
 */
export function registrationPhase(
  d: Pick<DomainRecord, "manualExpiresAt" | "registration" | "remindDays">,
  { warnDays, urgentDays }: { warnDays: number; urgentDays: number },
  now: Date,
): ExpiryPhase | null {
  const expires = registrationExpiry(d);
  if (!expires) return null;
  const days = daysUntil(expires, now);
  if (days < 0) return "expired";
  if (days <= urgentDays) return "urgent";
  if (days <= warnDays) return "warn";
  if (d.remindDays > 0 && days <= d.remindDays) return "remind";
  return "ok";
}

/**
 * Where a certificate stands. Certificates renew themselves, and Let's Encrypt lifetimes shrink
 * towards 45 days, so a fixed 30-day warning would always be on: it warns once less than a third
 * of the lifetime is left, the point where renewal should have happened. Invalid is urgent at once;
 * unreachable says nothing about the certificate, so no phase.
 */
export function certPhase(cert: CertInfo | null, now: Date): ExpiryPhase | null {
  if (!cert || cert.unreachable) return null;
  if (cert.error === "CERT_HAS_EXPIRED") return "expired";
  if (cert.error) return "urgent";
  if (!cert.expiresAt) return null;
  const left = new Date(cert.expiresAt).getTime() - now.getTime();
  if (left < 0) return "expired";
  if (left <= 7 * DAY) return "urgent";
  const lifetime = cert.validFrom
    ? new Date(cert.expiresAt).getTime() - new Date(cert.validFrom).getTime()
    : 90 * DAY;
  return left < lifetime / 3 ? "warn" : "ok";
}

/**
 * The alert state after a check. A notification goes out when the phase gets worse than what was
 * sent; back to ok starts over, so the next expiry warns again. Without a verdict (no date, host
 * unreachable) nothing changes, so a passing outage neither silences nor repeats a warning.
 */
export function nextAlert(
  alert: AlertState | null,
  phase: ExpiryPhase | null,
): { alert: AlertState; notify: boolean } {
  const prev: AlertState = alert ?? { phase: "ok", notifiedPhase: "ok" };
  if (phase === null) return { alert: prev, notify: false };
  if (phase === "ok") return { alert: { phase: "ok", notifiedPhase: "ok" }, notify: false };
  if (worse(phase, prev.notifiedPhase)) return { alert: { phase, notifiedPhase: phase }, notify: true };
  return { alert: { phase, notifiedPhase: prev.notifiedPhase }, notify: false };
}

export interface Limits {
  warnDays: number;
  urgentDays: number;
}

/** Something about a domain that needs attention now: for To do, the board and the digest. */
export interface DomainAttention {
  target: "registration" | "certificate";
  name: string;
  phase: Exclude<ExpiryPhase, "ok">;
  expiresAt: string | null;
  error: string;
  note: string;
  projectIds: string[];
}

/** Every registration and certificate that is not ok, worst first. */
export function domainAttention(
  watched: { domain: DomainRecord; hosts: HostRecord[] }[],
  limits: Limits,
  now: Date,
): DomainAttention[] {
  const out: DomainAttention[] = [];
  for (const { domain, hosts } of watched) {
    const reg = registrationPhase(domain, limits, now);
    if (reg && reg !== "ok")
      out.push({
        target: "registration",
        name: domain.name,
        phase: reg,
        expiresAt: registrationExpiry(domain),
        error: "",
        note: domain.note,
        projectIds: [...new Set(hosts.map((h) => h.project).filter(Boolean))],
      });
    for (const host of hosts) {
      const cert = certPhase(host.cert, now);
      if (cert && cert !== "ok")
        out.push({
          target: "certificate",
          name: host.name,
          phase: cert,
          expiresAt: host.cert?.expiresAt ?? null,
          error: host.cert?.error ?? "",
          note: "",
          projectIds: host.project ? [host.project] : [],
        });
    }
  }
  return out.sort((a, b) => PHASE_RANK[b.phase] - PHASE_RANK[a.phase] || a.name.localeCompare(b.name));
}

/** "registration expires in 12 days (2026-11-10)", "certificate expired on …", or why it is not valid. */
export function domainDetail(
  e: Pick<DomainAttention, "target" | "expiresAt" | "error">,
  now = new Date(),
): string {
  const what = e.target === "certificate" ? "certificate" : "registration";
  if (e.error) return `${what} not valid: ${e.error}`;
  if (!e.expiresAt) return `${what} expiry unknown`;
  const days = daysUntil(e.expiresAt, now);
  const date = e.expiresAt.slice(0, 10);
  if (days < 0) return `${what} expired on ${date}`;
  return `${what} expires ${days === 0 ? "today" : `in ${days === 1 ? "1 day" : `${days} days`}`} (${date})`;
}
