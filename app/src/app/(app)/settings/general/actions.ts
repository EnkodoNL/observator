// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { runAllChecks } from "@/lib/jobs/checks";
import { sendDigestIfDue } from "@/lib/notify/digest";
import { saveSettings, settingsSchema, type Settings } from "@/lib/settings";

export async function saveSettingsAction(
  input: Settings,
): Promise<{ error?: string; fieldErrors?: Record<string, string> }> {
  await requireUser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { error: "Please check the highlighted fields.", fieldErrors };
  }
  await saveSettings(parsed.data);
  revalidatePath("/", "layout");
  return {};
}

export async function runChecksAction(): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const result = await runAllChecks();
  revalidatePath("/", "layout");
  return result;
}

export async function sendDigestNowAction(): Promise<{ ok: boolean }> {
  await requireUser();
  await sendDigestIfDue({ force: true });
  return { ok: true };
}
