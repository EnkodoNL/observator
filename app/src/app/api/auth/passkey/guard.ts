// SPDX-License-Identifier: FSL-1.1-ALv2
import { relyingParty } from "@/lib/auth/passkeys";

/** Same-origin check for the JSON endpoints (WebAuthn verification checks the origin too). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === relyingParty().origin;
}

export const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
