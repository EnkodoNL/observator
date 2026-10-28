// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { adminPb } from "@/lib/pb/admin";
import { clearSessionCookie, clientIp, hasUsers, passwordLogin } from "@/lib/auth/session";
import { checkSetupCode, clearSetupCode } from "@/lib/auth/setup-code";
import { clearPending, startPending } from "@/lib/auth/two-factor";
import { tryLock } from "@/lib/kv";
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

  let login: Awaited<ReturnType<typeof passwordLogin>>;
  try {
    login = await passwordLogin(email, password);
  } catch {
    return { error: "Incorrect e-mail or password.", values: publicValues(values) };
  }
  limiter.reset(`email:${email}`);
  // Never a session from a password alone: the second factor comes first.
  await startPending(login.user, login.token, safeNext(next));
  redirect("/login/verify");
}

const setupSchema = z
  .object({
    setupCode: z.string().trim().default(""),
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
  const { setupCode, email, password, passwordConfirm } = parsed.data;

  if (!limiter.take(`setup:${await clientIp()}`)) {
    return { error: "Too many attempts. Try again in a few minutes.", values: publicValues(values) };
  }
  if (!(await checkSetupCode(setupCode))) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: { setupCode: "That is not the setup code from the log." },
      values: publicValues(values),
    };
  }
  // One account, also when two submissions race: the lock, then the check again.
  const release = await tryLock("setup", 30_000);
  if (!release)
    return { error: "Setup is already running. Try again in a moment.", values: publicValues(values) };
  try {
    if (await hasUsers()) redirect("/login");
    const pb = await adminPb();
    try {
      await pb.collection("users").create({ email, password, passwordConfirm, verified: true });
    } catch {
      return { error: "Could not create the account.", values: publicValues(values) };
    }
    await clearSetupCode();
  } finally {
    await release();
  }
  const login = await passwordLogin(email, password);
  await startPending(login.user, login.token, "/");
  redirect("/login/verify");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  await clearPending();
  redirect("/login");
}
