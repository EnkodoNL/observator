// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** User-facing message for a failed ceremony; null when the user simply cancelled. */
export function passkeyError(err: unknown): string | null {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_CEREMONY_ABORTED") return null;
    if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
      return "This device already has a passkey for Observator.";
  }
  if (err instanceof Error && err.name === "NotAllowedError") return null;
  if (err instanceof Error && err.name === "AbortError") return null;
  return err instanceof Error ? err.message : "Something went wrong";
}

export async function signInWithPasskey({ autofill = false } = {}): Promise<void> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
    "/api/auth/passkey/login/options",
  );
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
  await post("/api/auth/passkey/login/verify", { response });
}

export async function registerPasskey(name: string): Promise<void> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
    "/api/auth/passkey/register/options",
  );
  const response = await startRegistration({ optionsJSON });
  await post("/api/auth/passkey/register/verify", { response, name });
}

/** A sensible default name for a new passkey, based on the browser's platform. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Passkey";
}
