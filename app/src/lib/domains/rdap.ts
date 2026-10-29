// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import type { RegistrationInfo } from "@/lib/pb/types";

/*
 * Registration expiry from RDAP, the registries' JSON successor to WHOIS. IANA's bootstrap file
 * says which server answers for a TLD. Not every registry takes part (.eu, .be, .io), and some
 * publish no expiry at all (.nl, .de): for those the date is entered by hand.
 */

const BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_KEY = "rdap:bootstrap";
const DAY = 86_400_000;
// SIDN trips its limit after a handful of requests a minute; this keeps well under it per server.
const GAP_MS = 2000;

interface Bootstrap {
  fetchedAt: number;
  services: [string[], string[]][];
}

/** The RDAP base URL for a domain's TLD, or null when its registry is not in the bootstrap file. */
export function rdapBase(services: Bootstrap["services"], domain: string): string | null {
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  const entry = services.find(([tlds]) => tlds.includes(tld));
  const base = entry?.[1].find((u) => u.startsWith("https://")) ?? entry?.[1][0];
  return base ? (base.endsWith("/") ? base : `${base}/`) : null;
}

/** What an RDAP reply says: the expiration event, or that the server is rate limiting. */
export function parseRdap(body: unknown): { expiresAt: string | null; rateLimited: boolean } {
  const b = (body ?? {}) as { errorCode?: number; events?: { eventAction?: string; eventDate?: string }[] };
  // SIDN sometimes answers a rate limit with HTTP 200 and the 429 in the body.
  if (b.errorCode === 429) return { expiresAt: null, rateLimited: true };
  const event = (b.events ?? []).find((e) => e.eventAction === "expiration" && e.eventDate);
  const date = event ? new Date(event.eventDate!) : null;
  return { expiresAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null, rateLimited: false };
}

async function bootstrap(): Promise<Bootstrap["services"]> {
  const cached = await kvGet<Bootstrap>(BOOTSTRAP_KEY);
  if (cached && Date.now() - cached.fetchedAt < DAY) return cached.services;
  try {
    const res = await fetch(BOOTSTRAP, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "observator" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { services } = (await res.json()) as Pick<Bootstrap, "services">;
    if (!Array.isArray(services)) throw new Error("no services in the bootstrap file");
    await kvSet(BOOTSTRAP_KEY, { fetchedAt: Date.now(), services });
    return services;
  } catch (err) {
    // A day-old list is still right for nearly every TLD.
    if (cached) return cached.services;
    throw err;
  }
}

const g = globalThis as typeof globalThis & { __rdapLast?: Map<string, number> };
const lastRequest = (g.__rdapLast ??= new Map());

async function politely(host: string): Promise<void> {
  const wait = (lastRequest.get(host) ?? 0) + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest.set(host, Date.now());
}

/** The registration of `domain` (a registered domain, such as enkodo.dev) as its registry has it. */
export async function lookupRegistration(domain: string): Promise<RegistrationInfo> {
  const checkedAt = new Date().toISOString();
  const failed = (error: string): RegistrationInfo => ({
    expiresAt: null,
    source: "failed",
    error,
    checkedAt,
  });
  let base: string | null;
  try {
    base = rdapBase(await bootstrap(), domain);
  } catch (err) {
    return failed(`RDAP bootstrap unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!base) return { expiresAt: null, source: "unsupported", checkedAt };

  await politely(new URL(base).host);
  let res: Response;
  try {
    res = await fetch(`${base}domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json, application/json", "user-agent": "observator" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return failed(
      err instanceof Error && err.name === "TimeoutError" ? "registry timed out" : "registry unreachable",
    );
  }
  if (res.status === 404) return failed("the registry does not know this domain");
  if (res.status === 429) return failed("the registry is rate limiting; tried again later");
  if (!res.ok) return failed(`registry answered HTTP ${res.status}`);
  const parsed = parseRdap(await res.json().catch(() => null));
  if (parsed.rateLimited) return failed("the registry is rate limiting; tried again later");
  return parsed.expiresAt
    ? { expiresAt: parsed.expiresAt, source: "rdap", checkedAt }
    : { expiresAt: null, source: "unpublished", checkedAt };
}
