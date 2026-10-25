// SPDX-License-Identifier: FSL-1.1-ALv2
import { registrationOptions } from "@/lib/auth/passkeys";
import { getSession } from "@/lib/auth/session";
import { json, sameOrigin } from "../../guard";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request" });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first" });
  return json(200, await registrationOptions(session.user));
}
