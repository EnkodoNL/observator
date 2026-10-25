// SPDX-License-Identifier: FSL-1.1-ALv2
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238) with the parameters every authenticator app supports: SHA-1, 6 digits, 30 s.
const PERIOD = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i === -1) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) value for one counter. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export const stepAt = (time: Date) => Math.floor(time.getTime() / 1000 / PERIOD);

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the
 * matched step, or null. Steps at or before lastStep are refused, so a code works only once.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastStep: number,
  now = new Date(),
): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(clean))) return step;
  }
  return null;
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function otpauthUri(account: string, secret: string, issuer = "Observator"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params}`;
}

/** Ten single-use recovery codes like "7kq2-m9xa-4fdp", for a lost phone. */
export function newRecoveryCodes(count = 10): string[] {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const raw = Array.from(bytes, (b) => chars[b % chars.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
