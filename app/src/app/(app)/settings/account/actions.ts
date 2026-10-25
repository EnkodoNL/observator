// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { qrSvg } from "@/lib/auth/qr";
import { passwordLogin, requireUser, setSessionCookie } from "@/lib/auth/session";
import { newTotpSecret, otpauthUri } from "@/lib/auth/totp";
import {
  checkSecondFactor,
  disableTotp,
  enableTotp,
  regenerateRecoveryCodes,
  twoFactorStatus,
} from "@/lib/auth/two-factor";
import { type FormState, formObject, zodState } from "@/lib/forms";
import { adminPb } from "@/lib/pb/admin";
import type { PasskeyRecord } from "@/lib/pb/types";

async function ownPasskey(id: string): Promise<PasskeyRecord> {
  const { user } = await requireUser();
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

export async function deletePasskeyAction(id: string): Promise<void> {
  const passkey = await ownPasskey(id);
  const pb = await adminPb();
  await pb.collection("passkeys").delete(passkey.id);
  revalidatePath("/settings/account");
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
  const { user } = await requireUser();
  const parsed = passwordSchema.safeParse(formObject(data));
  if (!parsed.success) return zodState(parsed.error);
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
  const { user } = await requireUser();
  const secret = newTotpSecret();
  return { secret, qr: qrSvg(otpauthUri(user.email, secret)) };
}

export async function confirmTotpSetupAction(
  secret: string,
  code: string,
): Promise<{ codes?: string[]; error?: string }> {
  const { user } = await requireUser();
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
  const { user } = await requireUser();
  const check = await checkSecondFactor(user.id, code);
  if (!check.ok) return { error: check.error };
  const codes = await regenerateRecoveryCodes(user.id);
  revalidatePath("/settings/account");
  return { codes };
}

export async function disableTotpAction(code: string): Promise<{ ok?: boolean; error?: string }> {
  const { user } = await requireUser();
  const check = await checkSecondFactor(user.id, code);
  if (!check.ok) return { error: check.error };
  await disableTotp(user.id);
  revalidatePath("/settings/account");
  return { ok: true };
}
