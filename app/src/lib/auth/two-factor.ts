// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { cookies } from "next/headers";
import { randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { secureCookies } from "@/lib/env";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { UserRecord } from "@/lib/pb/types";
import { RateLimiter } from "@/lib/rate-limit";
import { setSessionCookie } from "./session";
import { newRecoveryCodes, normalizeRecoveryCode, verifyTotp } from "./totp";

interface TwoFactorFields extends UserRecord {
  totpSecret: string;
  totpEnabledAt: string;
  totpLastStep: number;
  recoveryCodes: string[] | null;
}

export interface TwoFactorStatus {
  totp: boolean;
  enabledAt: string;
  passkeys: number;
  recoveryLeft: number;
}

/** After a correct password, before the second factor: kept in memory, tied to a cookie. */
interface Pending {
  userId: string;
  email: string;
  token: string;
  next: string;
  expires: number;
  attempts: number;
  enrollSecret?: string;
  /** Set right after enrolment; the session starts only once the user has seen them. */
  recoveryCodes?: string[];
}

const COOKIE = "obs_2fa";
const TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

const g = globalThis as typeof globalThis & {
  __pending2fa?: Map<string, Pending>;
  __2faLimiter?: RateLimiter;
};
const pending = (g.__pending2fa ??= new Map());
// Per user, across pending sessions: 10 wrong codes per 15 minutes.
const limiter = (g.__2faLimiter ??= RateLimiter.perWindow(10, 15 * 60 * 1000));

export async function startPending(
  user: { id: string; email: string },
  token: string,
  next: string,
): Promise<void> {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const id = randomToken(24);
  pending.set(id, { userId: user.id, email: user.email, token, next, expires: now + TTL_MS, attempts: 0 });
  (await cookies()).set({
    name: COOKIE,
    value: id,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function getPending(): Promise<(Pending & { id: string }) | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const entry = pending.get(id);
  if (!entry || entry.expires < Date.now()) {
    pending.delete(id);
    return null;
  }
  return Object.assign(entry, { id });
}

export async function clearPending(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) pending.delete(id);
  jar.delete(COOKIE);
}

/** The second factor passed: the password session becomes a real one. */
export async function completeLogin(p: Pending): Promise<string> {
  await setSessionCookie(p.token);
  await clearPending();
  return p.next;
}

async function loadUser(userId: string): Promise<TwoFactorFields> {
  const pb = await adminPb();
  return pb.collection("users").getOne<TwoFactorFields>(userId);
}

export async function twoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const pb = await adminPb();
  const [user, passkeys] = await Promise.all([
    loadUser(userId),
    pb
      .collection("passkeys")
      .getList(1, 1, { filter: pb.filter("user = {:id}", { id: userId }), fields: "id" }),
  ]);
  return {
    totp: Boolean(user.totpSecret),
    enabledAt: user.totpEnabledAt,
    passkeys: passkeys.totalItems,
    recoveryLeft: (user.recoveryCodes ?? []).length,
  };
}

export type CodeResult =
  { ok: true; via: "totp" | "recovery"; recoveryLeft: number } | { ok: false; error: string };

/** Checks an authenticator code or a recovery code; each works once. */
export async function checkSecondFactor(userId: string, input: string): Promise<CodeResult> {
  // Counts wrong codes only: a success resets it, like the password limiter.
  if (!limiter.take(userId)) return { ok: false, error: "Too many attempts. Wait a few minutes." };
  const user = await loadUser(userId);
  const pb = await adminPb();
  const codes = user.recoveryCodes ?? [];

  if (user.totpSecret && /^\s*\d{3}\s?\d{3}\s*$/.test(input)) {
    const step = verifyTotp(user.totpSecret, input, user.totpLastStep ?? 0);
    if (step === null)
      return {
        ok: false,
        error: "That code is not valid. Check the time on your phone, or use a recovery code.",
      };
    await pb.collection("users").update(userId, { totpLastStep: step });
    limiter.reset(userId);
    return { ok: true, via: "totp", recoveryLeft: codes.length };
  }

  const hash = sha256(normalizeRecoveryCode(input));
  const match = codes.find((c) => safeEqual(c, hash));
  if (!match) return { ok: false, error: "That code is not valid." };
  await pb.collection("users").update(userId, { recoveryCodes: codes.filter((c) => c !== match) });
  limiter.reset(userId);
  return { ok: true, via: "recovery", recoveryLeft: codes.length - 1 };
}

/** Saves a verified authenticator and returns fresh recovery codes (shown once). */
export async function enableTotp(userId: string, secret: string, code: string): Promise<string[] | null> {
  const step = verifyTotp(secret, code, 0);
  if (step === null) return null;
  const recovery = newRecoveryCodes();
  const pb = await adminPb();
  await pb.collection("users").update(userId, {
    totpSecret: secret,
    totpEnabledAt: toPbDate(new Date()),
    totpLastStep: step,
    recoveryCodes: recovery.map((c) => sha256(normalizeRecoveryCode(c))),
  });
  return recovery;
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const recovery = newRecoveryCodes();
  const pb = await adminPb();
  await pb
    .collection("users")
    .update(userId, { recoveryCodes: recovery.map((c) => sha256(normalizeRecoveryCode(c))) });
  return recovery;
}

/** Turns the authenticator off; the next password sign-in asks to set one up again. */
export async function disableTotp(userId: string): Promise<void> {
  const pb = await adminPb();
  await pb
    .collection("users")
    .update(userId, { totpSecret: "", totpEnabledAt: "", totpLastStep: 0, recoveryCodes: [] });
}

/**
 * Whether removing one factor still leaves another. An account without any is back at first
 * sign-in, where anyone with the password could link their own authenticator.
 */
export function keepsAFactor(status: TwoFactorStatus, removing: "totp" | "passkey"): boolean {
  return removing === "totp" ? status.passkeys > 0 : status.totp || status.passkeys > 1;
}

/**
 * For a colleague who lost their device: removes every second factor and signs them out
 * everywhere, so their next password sign-in sets up a new authenticator.
 */
export async function resetSecondFactors(userId: string): Promise<void> {
  await disableTotp(userId);
  const pb = await adminPb();
  const passkeys = await pb
    .collection("passkeys")
    .getFullList({ filter: pb.filter("user = {:u}", { u: userId }) });
  for (const p of passkeys) await pb.collection("passkeys").delete(p.id);
  // A new tokenKey invalidates every token PocketBase issued for this user.
  await pb.collection("users").update(userId, { tokenKey: randomToken(32) });
}
