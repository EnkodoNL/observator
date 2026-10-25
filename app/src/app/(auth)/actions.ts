// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { adminPb } from "@/lib/pb/admin";
import { clearSessionCookie, clientIp, hasUsers, passwordLogin, setSessionCookie } from "@/lib/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { type FormState, formObject, publicValues, safeNext, zodState } from "@/lib/forms";

const g = globalThis as typeof globalThis & { __loginLimiter?: RateLimiter };
// 10 attempts per 15 minutes, per IP and per e-mail address.
const limiter = (g.__loginLimiter ??= RateLimiter.perWindow(10, 15 * 60 * 1000));

const loginSchema = z.object({
  email: z.email("Enter a valid e-mail address.").toLowerCase(),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export async function loginAction(_prev: FormState, data: FormData): Promise<FormState> {
  const values = formObject(data);
  const parsed = loginSchema.safeParse(values);
  if (!parsed.success) return zodState(parsed.error, values);
  const { email, password, next } = parsed.data;

  const ip = await clientIp();
  if (!limiter.take(`ip:${ip}`) || !limiter.take(`email:${email}`)) {
    return { error: "Too many attempts. Try again in a few minutes.", values: publicValues(values) };
  }

  let token: string;
  try {
    token = await passwordLogin(email, password);
  } catch {
    return { error: "Incorrect e-mail or password.", values: publicValues(values) };
  }
  limiter.reset(`email:${email}`);
  await setSessionCookie(token);
  redirect(safeNext(next));
}

const setupSchema = z
  .object({
    email: z.email("Enter a valid e-mail address.").toLowerCase(),
    password: z.string().min(10, "Use at least 10 characters."),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Passwords do not match.",
  });

export async function setupAction(_prev: FormState, data: FormData): Promise<FormState> {
  if (await hasUsers()) redirect("/login");
  const values = formObject(data);
  const parsed = setupSchema.safeParse(values);
  if (!parsed.success) return zodState(parsed.error, values);
  const { email, password, passwordConfirm } = parsed.data;

  const pb = await adminPb();
  try {
    await pb.collection("users").create({ email, password, passwordConfirm, verified: true });
  } catch {
    return { error: "Could not create the account.", values: publicValues(values) };
  }
  await setSessionCookie(await passwordLogin(email, password));
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
