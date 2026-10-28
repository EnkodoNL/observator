// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { qrSvg } from "@/lib/auth/qr";
import {
  clearSessionCookie,
  isFreshSession,
  passwordLogin,
  requireWriter,
  setSessionCookie,
  STALE_SESSION_ERROR,
} from "@/lib/auth/session";
import { newTotpSecret, otpauthUri } from "@/lib/auth/totp";
import {
  checkSecondFactor,
  disableTotp,
  enableTotp,
  keepsAFactor,
  regenerateRecoveryCodes,
  twoFactorStatus,
} from "@/lib/auth/two-factor";
import { createMcpToken, revokeMcpToken } from "@/lib/data/mcp-tokens";
import { type FormState, formObject, zodState } from "@/lib/forms";
import { randomToken } from "@/lib/crypto";
import { RateLimiter } from "@/lib/rate-limit";
import { adminPb } from "@/lib/pb/admin";
import type { PasskeyRecord } from "@/lib/pb/types";

const g = globalThis as typeof globalThis & { __passwordCheckLimiter?: RateLimiter };
// Changing the password and creating an MCP token both ask for the password again; one shared
// limit per user keeps a stolen session from guessing it through either.
const passwordCheckLimiter = (g.__passwordCheckLimiter ??= RateLimiter.perWindow(10, 15 * 60 * 1000));

async function ownPasskey(id: string): Promise<PasskeyRecord> {
  const { user } = await requireWriter();
  const pb = await adminPb();
  const passkey = await pb.collection("passkeys").getOne<PasskeyRecord>(z.string().min(1).parse(id));
  if (passkey.user !== user.id) throw new Error("Not your passkey");
  return passkey;
}

export async function renamePasskeyAction(id: string, name: string): Promise<void> {
  const passkey = await ownPasskey(id);
  const pb = await adminPb();
  await pb.collection("passkeys").update(passkey.id, { name: z.string().trim().min(1).max(100).parse(name) });
  revalidatePath("/settings/account");
}

export async function deletePasskeyAction(id: string): Promise<{ error?: string }> {
  const passkey = await ownPasskey(id);
  if (!(await isFreshSession())) return { error: STALE_SESSION_ERROR };
  if (!keepsAFactor(await twoFactorStatus(passkey.user), "passkey"))
    return { error: "Set up an authenticator app before you remove your last passkey." };
  const pb = await adminPb();
  await pb.collection("passkeys").delete(passkey.id);
  revalidatePath("/settings/account");
  return {};
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    password: z.string().min(10, "Use at least 10 characters."),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match.",
  });

/** Changing the password rotates the user's token key: every session ends, this one is renewed. */
export async function changePasswordAction(_prev: FormState, data: FormData): Promise<FormState> {
  const { user } = await requireWriter();
  const parsed = passwordSchema.safeParse(formObject(data));
  if (!parsed.success) return zodState(parsed.error);
  if (!passwordCheckLimiter.take(user.id)) return { error: "Too many attempts. Try again in a few minutes." };
  try {
    await passwordLogin(user.email, parsed.data.current);
  } catch {
    return { error: "Current password is incorrect.", fieldErrors: { current: "Incorrect password." } };
  }
  const pb = await adminPb();
  await pb.collection("users").update(user.id, {
    password: parsed.data.password,
    passwordConfirm: parsed.data.passwordConfirm,
  });
  // Same person, already past the second factor in this session: keep them signed in.
  await setSessionCookie((await passwordLogin(user.email, parsed.data.password)).token);
  return { ok: true, message: "Password changed. Other sessions have been signed out." };
}

export async function beginTotpSetupAction(): Promise<{ secret: string; qr: string }> {
  const { user } = await requireWriter();
  const secret = newTotpSecret();
  return { secret, qr: qrSvg(otpauthUri(user.email, secret)) };
}

export async function confirmTotpSetupAction(
  secret: string,
  code: string,
): Promise<{ codes?: string[]; error?: string }> {
  const { user } = await requireWriter();
  if (!(await isFreshSession())) return { error: STALE_SESSION_ERROR };
  const status = await twoFactorStatus(user.id);
  if (status.totp) return { error: "An authenticator is already set up. Turn it off first to replace it." };
  if (!/^[A-Z2-7]{32}$/.test(secret)) return { error: "Start the setup again." };
  const codes = await enableTotp(user.id, secret, code);
  revalidatePath("/settings/account");
  return codes
    ? { codes }
    : { error: "That code does not match. Check that the time on your phone is set automatically." };
}

/** Changing two-factor settings needs a current code, so a stolen session alone cannot do it. */
export async function regenerateRecoveryAction(code: string): Promise<{ codes?: string[]; error?: string }> {
  const { user } = await requireWriter();
  const check = await checkSecondFactor(user.id, code);
  if (!check.ok) return { error: check.error };
  const codes = await regenerateRecoveryCodes(user.id);
  revalidatePath("/settings/account");
  return { codes };
}

export async function disableTotpAction(code: string): Promise<{ ok?: boolean; error?: string }> {
  const { user } = await requireWriter();
  if (!keepsAFactor(await twoFactorStatus(user.id), "totp"))
    return { error: "Add a passkey before you turn off the authenticator app." };
  const check = await checkSecondFactor(user.id, code);
  if (!check.ok) return { error: check.error };
  await disableTotp(user.id);
  revalidatePath("/settings/account");
  return { ok: true };
}

const mcpTokenSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name").max(100),
  canWrite: z.boolean(),
  password: z.string().min(1, "Enter your password"),
});

/**
 * A token acts as you on /api/mcp without a second factor, so it needs the password again
 * (sudo mode), on top of the signed-in session.
 */
export async function createMcpTokenAction(
  input: z.infer<typeof mcpTokenSchema>,
): Promise<{ token?: string; error?: string }> {
  const { user } = await requireWriter();
  const parsed = mcpTokenSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!passwordCheckLimiter.take(user.id)) return { error: "Too many attempts. Try again in a few minutes." };
  try {
    await passwordLogin(user.email, parsed.data.password);
  } catch {
    return { error: "That password is not right." };
  }
  passwordCheckLimiter.reset(user.id);
  const { token } = await createMcpToken(user.id, parsed.data.name, parsed.data.canWrite);
  revalidatePath("/settings/account");
  return { token };
}

export async function revokeMcpTokenAction(id: string): Promise<void> {
  const { user } = await requireWriter();
  await revokeMcpToken(user.id, z.string().min(1).parse(id));
  revalidatePath("/settings/account");
}

/**
 * Ends every session of this user, this one included: a new token key invalidates every token
 * PocketBase issued. Signing out only drops this browser's cookie; a copied one would live on.
 */
export async function signOutEverywhereAction(): Promise<void> {
  const { user } = await requireWriter();
  const pb = await adminPb();
  await pb.collection("users").update(user.id, { tokenKey: randomToken(32) });
  await clearSessionCookie();
  redirect("/login");
}
