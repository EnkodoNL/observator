// SPDX-License-Identifier: FSL-1.1-ALv2
import { certPhase, daysUntil, registrationExpiry } from "@/lib/domains/phase";
import type { DomainRecord, ExpiryPhase, HostRecord } from "@/lib/pb/types";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const PHASE_TEXT: Record<ExpiryPhase, string> = {
  ok: "text-foreground",
  remind: "text-primary",
  warn: "text-warn",
  urgent: "text-danger font-bold",
  expired: "text-danger font-bold",
};

function when(date: string, now: Date): string {
  const days = daysUntil(date, now);
  const day = date.slice(0, 10);
  if (days < 0) return `expired on ${day}`;
  if (days === 0) return `expires today`;
  return `expires in ${plural(days, "day")} (${day})`;
}

/** The registration in a few words, and where the date comes from. */
export function Registration({
  domain,
  phase,
  now,
}: {
  domain: DomainRecord;
  phase: ExpiryPhase | null;
  now: Date;
}) {
  const expires = registrationExpiry(domain);
  const r = domain.registration;
  if (expires)
    return (
      <span>
        <span className={cn(PHASE_TEXT[phase ?? "ok"])}>Registration {when(expires, now)}</span>
        <span className="text-muted-foreground">
          {" "}
          · {domain.manualExpiresAt ? "date entered by hand" : "from the registry"}
          {r?.error && `, last check failed: ${r.error}`}
        </span>
      </span>
    );
  const tld = domain.name.slice(domain.name.lastIndexOf("."));
  const why = !r
    ? "Not checked yet."
    : r.source === "unpublished"
      ? `The ${tld} registry publishes no expiry date. Enter it with Edit to get warnings.`
      : r.source === "unsupported"
        ? `${tld} has no public registry lookup (RDAP). Enter the date with Edit to get warnings.`
        : `Registry lookup failed: ${r.error}.`;
  return <span className="text-muted-foreground">{why}</span>;
}

export function Certificate({ host, now }: { host: HostRecord; now: Date }) {
  const c = host.cert;
  if (!c) return <span className="text-muted-foreground">not checked yet</span>;
  if (c.unreachable) return <span className="text-warn">unreachable ({c.unreachable})</span>;
  const phase = certPhase(c, now);
  if (c.error)
    return <span className={cn(PHASE_TEXT[phase ?? "urgent"])}>certificate not valid: {c.error}</span>;
  return (
    <span>
      <span className={cn(PHASE_TEXT[phase ?? "ok"])}>
        certificate {c.expiresAt ? when(c.expiresAt, now) : "without a date"}
      </span>
      {c.issuer && <span className="text-muted-foreground"> · {c.issuer}</span>}
    </span>
  );
}
