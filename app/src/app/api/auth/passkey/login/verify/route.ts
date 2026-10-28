// SPDX-License-Identifier: FSL-1.1-ALv2
import { verifyAuthentication } from "@/lib/auth/passkeys";
import { impersonate, setSessionCookie } from "@/lib/auth/session";
import { clearPending } from "@/lib/auth/two-factor";
import { json, sameOrigin } from "../../guard";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request" });
  try {
    const { response } = await request.json();
    const userId = await verifyAuthentication(response);
    await setSessionCookie(await impersonate(userId), { fresh: true });
    // A passkey is enough on its own; drop any half-finished password sign-in.
    await clearPending();
    return json(200, { ok: true });
  } catch (err) {
    return json(401, { error: err instanceof Error ? err.message : "Sign-in failed" });
  }
}
