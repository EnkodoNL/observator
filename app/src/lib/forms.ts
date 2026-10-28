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

const BASE = "http://observator.invalid";

/**
 * Only same-origin paths. Whitespace and control characters are refused outright: browsers strip
 * tabs and newlines from URLs, so "/\t/evil.com" would become "//evil.com". What remains is
 * resolved and must stay on this origin; the result is the normalised path.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || /[\s\x00-\x1f\x7f\\]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  return url.pathname + url.search + url.hash;
}
