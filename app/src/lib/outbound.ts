// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { lookup } from "node:dns/promises";
import { inRange, parseAddress } from "@/lib/client-ip";
import { env } from "@/lib/env";

/*
 * Guard for requests to URLs a user typed in: deploy webhooks and notification channels. Hosts on
 * the LAN stay allowed (a Coolify or ntfy next door is the normal case); what is refused is the
 * container itself, link-local addresses (cloud metadata lives at 169.254.169.254) and Observator's
 * own PocketBase.
 */

const BLOCKED_RANGES = ["127.0.0.0/8", "0.0.0.0/8", "169.254.0.0/16", "::1/128", "::/128", "fe80::/10"];

// Fixed public APIs whose error replies are worth showing ("chat not found"); from anywhere else
// only the status comes back, so a request cannot be used to read an internal service.
const KNOWN_APIS = new Set([
  "api.telegram.org",
  "api.pushover.net",
  "hooks.slack.com",
  "discord.com",
  "discordapp.com",
]);

export class OutboundError extends Error {}

async function addressesOf(host: string): Promise<string[]> {
  if (parseAddress(host)) return [host];
  return (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
}

/** The URL when it may be called; throws OutboundError with the reason otherwise. */
export async function checkOutbound(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OutboundError("only http and https");
  if (url.protocol === "https:" && KNOWN_APIS.has(url.hostname)) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const db = new URL(env().PB_URL).hostname.replace(/^\[|\]$/g, "");
  const [addresses, dbAddresses] = await Promise.all([addressesOf(host), addressesOf(db)]);
  for (const a of addresses) {
    const parsed = parseAddress(a);
    if (parsed && BLOCKED_RANGES.some((r) => inRange(parsed, r)))
      throw new OutboundError(`${host} points at a local or link-local address`);
  }
  if (host.toLowerCase() === db.toLowerCase() || addresses.some((a) => dbAddresses.includes(a)))
    throw new OutboundError(`${host} is Observator's own database`);
  return url;
}

/** Whether an error reply from this host may be shown, see KNOWN_APIS. */
export const showsReplies = (url: URL) => KNOWN_APIS.has(url.hostname);

export const isRedirect = (status: number) => status >= 300 && status < 400;
