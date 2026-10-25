// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, passwordLogin } from "@/lib/auth/session";
import { startPending } from "@/lib/auth/two-factor";
import { findInvite, markInviteUsed } from "@/lib/data/users";
import { type FormState, formObject, publicValues, zodState } from "@/lib/forms";
import { adminPb, isUniqueViolation } from "@/lib/pb/admin";
import { RateLimiter } from "@/lib/rate-limit";

const g = globalThis as typeof globalThis & { __inviteLimiter?: RateLimiter };
const limiter = (g.__inviteLimiter ??= RateLimiter.perWindow(10, 15 * 60 * 1000));

const schema = z
  .object({
    token: z.string(),
    email: z.email("Enter a valid e-mail address.").toLowerCase(),
    password: z.string().min(10, "Use at least 10 characters."),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match.",
  });

export async function acceptInviteAction(_prev: FormState, data: FormData): Promise<FormState> {
  const values = formObject(data);
  if (!limiter.take(await clientIp())) return { error: "Too many attempts. Try again in a few minutes." };
  const parsed = schema.safeParse(values);
  if (!parsed.success) return zodState(parsed.error, values);
  const { token, email, password, passwordConfirm } = parsed.data;

  const invite = await findInvite(token);
  if (!invite) return { error: "This invite link is no longer valid. Ask for a new one." };
  const pb = await adminPb();
  try {
    await pb.collection("users").create({ email, password, passwordConfirm, verified: true });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "An account with this e-mail already exists.", values: publicValues(values) };
    }
    return { error: "Could not create the account.", values: publicValues(values) };
  }
  await markInviteUsed(invite.id);
  const login = await passwordLogin(email, password);
  await startPending(login.user, login.token, "/");
  redirect("/login/verify");
}
