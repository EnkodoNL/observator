// SPDX-License-Identifier: FSL-1.1-ALv2
import { formatAddress, inRange, parseAddress } from "@/lib/client-ip";

/**
 * IP allowlists of shared keys: builds from these addresses may report without a key and
 * count as that key. Entries are stored as normalized CIDRs ("198.51.100.4/32") with an
 * optional note, written as a "#" comment in the editor.
 */

export interface AllowEntry {
  cidr: string;
  note: string;
}

export const MAX_ENTRIES = 50;
// Anything wider would let a whole provider in.
const MIN_PREFIX = { 4: 8, 6: 32 } as const;

function parseEntry(raw: string): { cidr: string } | { error: string } {
  const [base, bits, ...rest] = raw.split("/");
  const address = parseAddress(base);
  if (!address || rest.length) return { error: "is not an address or range" };
  const width = address.version === 4 ? 32 : 128;
  if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return { error: "has an invalid prefix" };
  const prefix = bits === undefined ? width : Number(bits);
  if (prefix > width) return { error: "has an invalid prefix" };
  if (prefix < MIN_PREFIX[address.version])
    return { error: `is too broad (at least /${MIN_PREFIX[address.version]})` };
  // Providers hand out an IPv6 /64 per server and show it as "2a01:4f8:c2c:9793::". Written
  // without a prefix that is only the address ending in zeros, which the server rarely uses.
  if (
    address.version === 6 &&
    bits === undefined &&
    address.value !== 0n &&
    (address.value & ((1n << 64n) - 1n)) === 0n
  )
    return {
      error: `is only the single address ending in zeros; for the server's whole subnet write ${base}/64 (or ${base}/128 for just this address)`,
    };
  // 198.51.100.4/24 means 198.51.100.0/24.
  const shift = BigInt(width - prefix);
  const network = { ...address, value: (address.value >> shift) << shift };
  return { cidr: `${formatAddress(network)}/${prefix}` };
}

/** One address or range per line; "#" starts the note. */
export function parseAllowlist(text: string): { entries: AllowEntry[]; errors: string[] } {
  const entries: AllowEntry[] = [];
  const errors: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    const [raw, ...comment] = line.split("#");
    const value = raw.trim();
    const note = comment.join("#").trim().slice(0, 100);
    if (!value) continue;
    const parsed = parseEntry(value);
    if ("error" in parsed) errors.push(`Line ${i + 1}: “${value.slice(0, 60)}” ${parsed.error}.`);
    else if (!entries.some((e) => e.cidr === parsed.cidr)) entries.push({ cidr: parsed.cidr, note });
  }
  if (entries.length > MAX_ENTRIES) errors.push(`At most ${MAX_ENTRIES} addresses or ranges.`);
  return { entries, errors };
}

/** Back to the editor's text: one entry per line, the note as a comment. */
export function formatAllowlist(entries: AllowEntry[]): string {
  return entries.map((e) => `${displayEntry(e.cidr)}${e.note ? `  # ${e.note}` : ""}`).join("\n");
}

/** How an entry is shown: a single address without its /32 or /128. */
export function displayEntry(cidr: string): string {
  const single = cidr.includes(":") ? "/128" : "/32";
  if (!cidr.endsWith(single)) return cidr;
  const address = cidr.slice(0, -single.length);
  // "2a01:…::" alone reads as a subnet (and is refused as input), so it keeps its /128.
  return address.endsWith("::") && address !== "::" ? cidr : address;
}

const prefixOf = (cidr: string) => Number(cidr.split("/")[1]);

/** The most specific entry that contains the address, if any. */
export function matchEntry(ip: string, entries: string[]): string | null {
  const address = parseAddress(ip);
  if (!address) return null;
  return entries.filter((e) => inRange(address, e)).sort((a, b) => prefixOf(b) - prefixOf(a))[0] ?? null;
}

/** Whether two entries share any address: one then contains the other's network. */
export function overlaps(a: string, b: string): boolean {
  const na = parseAddress(a.split("/")[0]);
  const nb = parseAddress(b.split("/")[0]);
  if (!na || !nb || na.version !== nb.version) return false;
  return inRange(na, b) || inRange(nb, a);
}
