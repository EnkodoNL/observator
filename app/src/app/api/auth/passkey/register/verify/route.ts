// SPDX-License-Identifier: FSL-1.1-ALv2
import { verifyRegistration } from "@/lib/auth/passkeys";
import { getSession, isFreshSession, STALE_SESSION_ERROR } from "@/lib/auth/session";
import { json, sameOrigin } from "../../guard";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request" });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first" });
  if (!(await isFreshSession())) return json(403, { error: STALE_SESSION_ERROR });
  try {
    const { response, name } = await request.json();
    const passkey = await verifyRegistration(session.user, response, String(name ?? ""));
    return json(200, { id: passkey.id });
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : "Registration failed" });
  }
}
