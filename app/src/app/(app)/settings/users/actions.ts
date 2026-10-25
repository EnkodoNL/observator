// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { disableTotp } from "@/lib/auth/two-factor";
import { createInvite, revokeInvite } from "@/lib/data/users";
import { env } from "@/lib/env";
import { adminPb } from "@/lib/pb/admin";

export async function createInviteAction(email: string): Promise<{ link?: string; error?: string }> {
  const { user } = await requireUser();
  const parsed = z.union([z.literal(""), z.email()]).safeParse(email.trim().toLowerCase());
  if (!parsed.success) return { error: "Enter a valid e-mail address, or leave it empty." };
  const token = await createInvite(user.id, parsed.data);
  revalidatePath("/settings/users");
  return { link: `${env().APP_URL}/invite/${token}` };
}

export async function revokeInviteAction(id: string): Promise<void> {
  await requireUser();
  await revokeInvite(z.string().min(1).parse(id));
  revalidatePath("/settings/users");
}

export async function removeUserAction(id: string): Promise<{ error?: string }> {
  const { user } = await requireUser();
  const target = z.string().min(1).parse(id);
  if (target === user.id) return { error: "You cannot remove yourself." };
  const pb = await adminPb();
  const total = await pb.collection("users").getList(1, 1, { fields: "id" });
  if (total.totalItems <= 1) return { error: "Observator needs at least one user." };
  // Passkeys go with the user (cascade); the user's sessions stop working immediately.
  await pb.collection("users").delete(target);
  revalidatePath("/settings/users");
  return {};
}

/** For a colleague who lost their phone: their next password sign-in sets up a new authenticator. */
export async function resetTwoFactorAction(id: string): Promise<{ error?: string }> {
  const { user } = await requireUser();
  const target = z.string().min(1).parse(id);
  if (target === user.id) return { error: "Change your own two-step verification under Account." };
  await disableTotp(target);
  revalidatePath("/settings/users");
  return {};
}
