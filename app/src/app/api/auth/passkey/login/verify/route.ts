// SPDX-License-Identifier: FSL-1.1-ALv2
import { verifyAuthentication } from "@/lib/auth/passkeys";
import { impersonate, setSessionCookie } from "@/lib/auth/session";
import { json, sameOrigin } from "../../guard";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request" });
  try {
    const { response } = await request.json();
    const userId = await verifyAuthentication(response);
    await setSessionCookie(await impersonate(userId));
    return json(200, { ok: true });
  } catch (err) {
    return json(401, { error: err instanceof Error ? err.message : "Sign-in failed" });
  }
}
