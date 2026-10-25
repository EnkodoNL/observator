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

type Pending = NonNullable<Awaited<ReturnType<typeof getPending>>>;

/** Counts a wrong code; the fifth one ends the sign-in. */
async function wrong(pending: Pending, error: string): Promise<FormState> {
  pending.attempts++;
  if (pending.attempts < MAX_ATTEMPTS) return { error };
  await clearPending();
  // A returned message would be lost: without a pending sign-in the page itself redirects.
  redirect("/login?reason=locked");
}

export async function verifyCodeAction(_prev: FormState, data: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending) redirect("/login?reason=expired");
  const result = await checkSecondFactor(pending.userId, String(data.get("code") ?? ""));
  if (!result.ok) return wrong(pending, result.error);
  redirect(await completeLogin(pending));
}

export async function enrollAction(_prev: FormState, data: FormData): Promise<FormState> {
  const pending = await getPending();
  if (!pending?.enrollSecret) redirect("/login?reason=expired");
  const codes = await enableTotp(pending.userId, pending.enrollSecret, String(data.get("code") ?? ""));
  if (!codes)
    return wrong(
      pending,
      "That code does not match. Check that the time on your phone is set automatically.",
    );
  // Show the recovery codes (server-rendered, so a reload shows them again) before the session starts.
  pending.enrollSecret = undefined;
  pending.recoveryCodes = codes;
  redirect("/login/verify");
}

export async function finishEnrollAction(): Promise<void> {
  const pending = await getPending();
  if (!pending?.recoveryCodes) redirect("/login?reason=expired");
  redirect(await completeLogin(pending));
}

export async function cancelAction(): Promise<void> {
  await clearPending();
  redirect("/login");
}
