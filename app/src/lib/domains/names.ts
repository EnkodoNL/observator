// SPDX-License-Identifier: FSL-1.1-ALv2
import { getDomain } from "tldts";
import { parseAddress } from "@/lib/client-ip";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export interface ParsedName {
  /** The name as checked: lowercase, IDN in its A-label (xn--) form. */
  host: string;
  /** The registered domain it belongs to: app.enkodo.dev belongs to enkodo.dev. */
  domain: string;
}

/**
 * A hostname from what someone typed or a build sent: a bare name or a URL, any case, IDN or not.
 * Null for an IP address, a public suffix alone (co.uk) or anything that is not a hostname.
 */
export function parseName(input: string): ParsedName | null {
  const raw = input.trim().replace(/\.$/, "");
  if (!raw) return null;
  let host: string;
  try {
    // The URL parser lowercases and turns an IDN into its A-label.
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  if (parseAddress(host) || !HOSTNAME.test(host)) return null;
  // The private part of the suffix list stays off: a name under vercel.app is registered as
  // vercel.app, and that is what the registry knows.
  const domain = getDomain(host, { allowPrivateDomains: false, extractHostname: false });
  return domain ? { host, domain } : null;
}

/** Names from a comma or whitespace separated list, with the ones that are not names apart. */
export function parseNames(input: string | readonly string[]): { names: ParsedName[]; invalid: string[] } {
  const parts = (typeof input === "string" ? input.split(/[\s,]+/) : [...input]).filter(Boolean);
  const names = new Map<string, ParsedName>();
  const invalid: string[] = [];
  for (const part of parts) {
    const parsed = parseName(part);
    if (parsed) names.set(parsed.host, parsed);
    else invalid.push(part);
  }
  return { names: [...names.values()], invalid };
}
