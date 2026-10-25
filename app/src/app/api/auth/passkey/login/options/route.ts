// SPDX-License-Identifier: FSL-1.1-ALv2
import { authenticationOptions } from "@/lib/auth/passkeys";
import { json, sameOrigin } from "../../guard";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request" });
  return json(200, await authenticationOptions());
}
