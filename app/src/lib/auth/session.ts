// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminPb, userPb } from "@/lib/pb/admin";
import { clientIpFrom, rateKey } from "@/lib/client-ip";
import { sha256 } from "@/lib/crypto";
import { env, secureCookies } from "@/lib/env";
import type { UserRecord } from "@/lib/pb/types";

export const SESSION_COOKIE = "obs_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface Session {
  user: Pick<UserRecord, "id" | "email" | "name">;
  /** A demo visitor (DEMO_MODE): may look, never change anything. */
  readOnly?: boolean;
}

/** Who a visitor without a session is in DEMO_MODE. Not a PocketBase user; it owns nothing. */
const DEMO_SESSION: Session = { user: { id: "demo", email: "Demo visitor", name: "Demo" }, readOnly: true };

/** How long after a full sign-in a session may change its sign-in factors. */
const FRESH_MS = 10 * 60 * 1000;
const g = globalThis as typeof globalThis & { __freshSessions?: Map<string, number> };
// Kept in the server, by token hash: a copied cookie cannot carry freshness along.
const fresh = (g.__freshSessions ??= new Map());

/**
 * Sets the session. `fresh`: it comes from a full sign-in (password plus second factor, or a
 * passkey), so for a few minutes it may add or remove passkeys and authenticators.
 */
export async function setSessionCookie(token: string, { fresh: isFresh = false } = {}): Promise<void> {
  if (isFresh) {
    const now = Date.now();
    for (const [k, until] of fresh) if (until < now) fresh.delete(k);
    fresh.set(sha256(token), now + FRESH_MS);
  }
  (await cookies()).set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Validates the session cookie against PocketBase. authRefresh works for both password
 * tokens and (non-renewable) impersonate tokens, and fails with 401 for anything invalid.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await userPb(token).collection("users").authRefresh<UserRecord>();
    return { user: { id: res.record.id, email: res.record.email, name: res.record.name } };
  } catch {
    return null;
  }
});

/** The signed-in user; in DEMO_MODE a visitor without a session gets the read-only demo session. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  if (env().DEMO_MODE) return DEMO_SESSION;
  redirect("/login");
}

/**
 * For anything that changes something: every server action except pure lookups. A demo visitor
 * is sent back to the page they were on, with a note that the demo is read-only.
 */
export async function requireWriter(): Promise<Session> {
  const session = await requireUser();
  if (!session.readOnly) return session;
  let path = "/";
  try {
    const from = new URL((await headers()).get("referer") ?? "");
    if (from.origin === new URL(env().APP_URL).origin) path = from.pathname;
  } catch {
    // No usable referer: back to the overview.
  }
  redirect(`${path}?demo=read-only`);
}

/**
 * Whether this session signed in fully in the last few minutes. Changing sign-in factors needs
 * it, so a stolen session cannot add a passkey of its own that outlives a password change.
 */
export async function isFreshSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const until = token ? fresh.get(sha256(token)) : undefined;
  return until !== undefined && until > Date.now();
}

export const STALE_SESSION_ERROR =
  "For your safety, sign out and in again first: changing sign-in methods needs a sign-in from the last 10 minutes.";

/**
 * Checks a password and returns the PocketBase token. That token is not a session yet: a
 * password always needs a second factor first (see two-factor.ts).
 */
export async function passwordLogin(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string } }> {
  const res = await userPb().collection("users").authWithPassword<UserRecord>(email, password);
  return { token: res.token, user: { id: res.record.id, email: res.record.email } };
}

/** Token for a user verified by other means (passkey, invite). */
export async function impersonate(userId: string): Promise<string> {
  const pb = await adminPb();
  const client = await pb.collection("users").impersonate(userId, SESSION_TTL_SECONDS);
  return client.authStore.token;
}

export async function hasUsers(): Promise<boolean> {
  const pb = await adminPb();
  const res = await pb.collection("users").getList(1, 1, { fields: "id" });
  return res.totalItems > 0;
}

/** Best-effort client address to rate-limit by (an IPv6 /64); the app sits behind a reverse proxy. */
export async function clientIp(): Promise<string> {
  return rateKey(clientIpFrom(await headers(), env().TRUSTED_PROXIES, env().TRUST_CLOUDFLARE));
}
