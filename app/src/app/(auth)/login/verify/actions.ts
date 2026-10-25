// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { redirect } from "next/navigation";
import {
  checkSecondFactor,
  clearPending,
  completeLogin,
  enableTotp,
  getPending,
  MAX_ATTEMPTS,
} from "@/lib/auth/two-factor";
import type { FormState } from "@/lib/forms";

const expired: FormState = { error: "This sign-in expired. Start again with your password." };

async function attempt(): Promise<Awaited<ReturnType<typeof getPending>> | FormState> {
  const pending = await getPending();
  if (!pending) return expired;
  pending.attempts++;
  if (pending.attempts > MAX_ATTEMPTS) {
    await clearPending();
    return { error: "Too many wrong codes. Start again with your password." };
  }
  return pending;
}

export async function verifyCodeAction(_prev: FormState, data: FormData): Promise<FormState> {
  const pending = await attempt();
  if (!pending || !("userId" in pending)) return pending ?? expired;
  const result = await checkSecondFactor(pending.userId, String(data.get("code") ?? ""));
  if (!result.ok) return { error: result.error };
  redirect(await completeLogin(pending));
}

export async function enrollAction(_prev: FormState, data: FormData): Promise<FormState> {
  const pending = await attempt();
  if (!pending || !("userId" in pending)) return pending ?? expired;
  if (!pending.enrollSecret) return expired;
  const codes = await enableTotp(pending.userId, pending.enrollSecret, String(data.get("code") ?? ""));
  if (!codes)
    return { error: "That code does not match. Check that the time on your phone is set automatically." };
  // Show the recovery codes (server-rendered, so a reload shows them again) before the session starts.
  pending.enrollSecret = undefined;
  pending.recoveryCodes = codes;
  redirect("/login/verify");
}

export async function finishEnrollAction(): Promise<void> {
  const pending = await getPending();
  if (!pending?.recoveryCodes) redirect("/login");
  redirect(await completeLogin(pending));
}

export async function cancelAction(): Promise<void> {
  await clearPending();
  redirect("/login");
}
