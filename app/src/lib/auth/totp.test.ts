// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hotp,
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  stepAt,
  verifyTotp,
} from "./totp";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("TOTP", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("matches the RFC 6238 vector at t=%i", (t, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(t / 30), 8)).toBe(expected);
  });

  it("round-trips base32", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(RFC_SECRET)).toBe(true);
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
  });

  it("accepts the current code once, with one step of drift either way", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = new Date(1234567890 * 1000);
    const step = stepAt(now);
    const code = hotp(RFC_SECRET, step);
    expect(verifyTotp(secret, code, 0, now)).toBe(step);
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, hotp(RFC_SECRET, step - 1), 0, now)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step - 2), 0, now)).toBeNull();
    expect(verifyTotp(secret, "12345", 0, now)).toBeNull();
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, 0, now)).toBe(step);
  });

  it("builds an otpauth URI authenticator apps understand", () => {
    expect(otpauthUri("me@example.com", "ABC")).toBe(
      "otpauth://totp/Observator%3Ame%40example.com?secret=ABC&issuer=Observator&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("makes distinct recovery codes that tolerate formatting", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalizeRecoveryCode(` ${codes[0].toUpperCase()} `)).toBe(codes[0].replace(/-/g, ""));
  });
});
