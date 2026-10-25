// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * The address a request really came from, for rate limits and for splitting shared-key
 * projects per server.
 *
 * Observator runs behind a reverse proxy (Coolify's Traefik, Caddy, nginx). Each proxy adds
 * the address it saw to the end of X-Forwarded-For; whatever comes before was sent by the
 * client and can say anything. So the entry to trust is the one the outermost of our own
 * proxies added: with TRUSTED_PROXIES = 1 the last one.
 *
 * When that address belongs to Cloudflare, the visitor is in CF-Connecting-IP, which
 * Cloudflare sets itself. Someone who skips Cloudflare and connects to the server directly
 * arrives from their own address, so a forged CF-Connecting-IP is not looked at.
 */

/** From https://www.cloudflare.com/ips/ (checked 2026-10-25). They rarely change. */
export const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

interface Address {
  version: 4 | 6;
  value: bigint;
}

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    value = (value << 8n) | BigInt(p);
  }
  return value;
}

function parseV6(s: string): bigint | null {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.split("::").length > 2) return null;
  // A trailing IPv4 part (::ffff:1.2.3.4) counts as two groups.
  let tail: string[] = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n === null) return null;
    tail = [(n >> 16n).toString(16), (n & 0xffffn).toString(16)];
    s = s.slice(0, -v4[1].length);
    // "::ffff:" loses its separator; a "::" right before the IPv4 part stays.
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const [head, rest] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = [...(rest ? rest.split(":") : []), ...tail];
  const groups =
    rest === undefined
      ? [...left, ...tail]
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/** Parses an address as proxies write it: plain, [bracketed], with a port, or IPv4-mapped. */
export function parseAddress(raw: string): Address | null {
  let s = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  if (s.includes(".") && !s.includes(":")) {
    const v = parseV4(s);
    return v === null ? null : { version: 4, value: v };
  }
  const v = parseV6(s);
  if (v === null) return null;
  // ::ffff:a.b.c.d is an IPv4 client on a dual-stack socket.
  if (v >> 32n === 0xffffn) return { version: 4, value: v & 0xffffffffn };
  return { version: 6, value: v };
}

export function formatAddress({ version, value }: Address): string {
  if (version === 4) return [24n, 16n, 8n, 0n].map((s) => String((value >> s) & 255n)).join(".");
  const groups = Array.from({ length: 8 }, (_, i) =>
    ((value >> BigInt(112 - 16 * i)) & 0xffffn).toString(16),
  );
  // Shorten the longest run of zero groups to "::", as addresses are usually written.
  let best = { start: -1, len: 1 };
  for (let i = 0; i < 8;) {
    let j = i;
    while (j < 8 && groups[j] === "0") j++;
    if (j - i > best.len) best = { start: i, len: j - i };
    i = j === i ? i + 1 : j;
  }
  if (best.start < 0) return groups.join(":");
  return `${groups.slice(0, best.start).join(":")}::${groups.slice(best.start + best.len).join(":")}`;
}

export function inRange(address: Address, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const net = parseAddress(base);
  if (!net || net.version !== address.version) return false;
  const width = address.version === 4 ? 32n : 128n;
  const prefix = BigInt(bits ?? width);
  const shift = width - prefix;
  return address.value >> shift === net.value >> shift;
}

const isCloudflare = (a: Address) => CLOUDFLARE_RANGES.some((r) => inRange(a, r));

/** The client's address, or "unknown" when the headers do not say. */
export function clientIpFrom(headers: Headers, trustedProxies = 1): string {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length === 0) return "unknown";
  const hop = parseAddress(chain[Math.max(0, chain.length - Math.max(1, trustedProxies))]);
  if (!hop) return "unknown";
  if (isCloudflare(hop)) {
    const visitor = parseAddress(headers.get("cf-connecting-ip") ?? "");
    if (visitor) return formatAddress(visitor);
  }
  return formatAddress(hop);
}
