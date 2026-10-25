// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordLogin, requireUser, setSessionCookie } from "@/lib/auth/session";
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
  await setSessionCookie(await passwordLogin(user.email, parsed.data.password));
  return { ok: true, message: "Password changed. Other sessions have been signed out." };
}
