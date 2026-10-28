// SPDX-License-Identifier: FSL-1.1-ALv2
import { authenticationOptions } from "@/lib/auth/passkeys";
import { clientIp } from "@/lib/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { json, sameOrigin } from "../../guard";

const g = globalThis as typeof globalThis & { __passkeyOptionsLimiter?: RateLimiter };
// Each request holds a challenge for five minutes; 30 a minute per address is plenty for a person.
const limiter = (g.__passkeyOptionsLimiter ??= RateLimiter.perWindow(30, 60 * 1000));

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { error: "Cross-origin request" });
  if (!limiter.take(await clientIp()))
    return json(429, { error: "Too many attempts. Try again in a minute." });
  try {
    return json(200, await authenticationOptions());
  } catch (err) {
    return json(503, { error: err instanceof Error ? err.message : "Try again in a minute." });
  }
}
