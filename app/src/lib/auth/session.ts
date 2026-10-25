// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminPb, userPb } from "@/lib/pb/admin";
import { clientIpFrom } from "@/lib/client-ip";
import { env, secureCookies } from "@/lib/env";
import type { UserRecord } from "@/lib/pb/types";

export const SESSION_COOKIE = "obs_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface Session {
  user: Pick<UserRecord, "id" | "email" | "name">;
}

export async function setSessionCookie(token: string): Promise<void> {
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

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

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

/** Best-effort client IP for rate limiting; the app normally sits behind a reverse proxy. */
export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers(), env().TRUSTED_PROXIES);
}
