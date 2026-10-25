// SPDX-License-Identifier: FSL-1.1-ALv2
import type { z } from "zod";

/** State returned by server actions used with useActionState. */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
  message?: string;
  /** Submitted non-secret values, echoed back so React's post-action form reset keeps them. */
  values?: Record<string, string>;
}

export function zodState(error: z.ZodError, values?: Record<string, string>): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  return { error: "Please check the highlighted fields.", fieldErrors, values: publicValues(values) };
}

/** Drops anything that looks like a secret before echoing values back to the browser. */
export function publicValues(values?: Record<string, string>): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).filter(([k]) => !/password|secret|token|key/i.test(k) && !k.startsWith("$")),
  );
}

export function formObject(data: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of data.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Only allow same-origin relative redirects. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
