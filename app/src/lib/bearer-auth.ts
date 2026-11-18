// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { clientIpFrom, rateKey } from "@/lib/client-ip";
import { findMcpToken, touchMcpToken, type McpCaller } from "@/lib/data/mcp-tokens";
import { env } from "@/lib/env";
import { RateLimiter } from "@/lib/rate-limit";

const g = globalThis as typeof globalThis & {
  __bearerLimits?: { probe: RateLimiter; perToken: RateLimiter };
};
const limits = () =>
  (g.__bearerLimits ??= {
    // Wrong tokens per address, across every endpoint that takes them; a correct one resets it.
    probe: RateLimiter.perWindow(30, 10 * 60 * 1000),
    // Generous for an agent going through many projects, a ceiling for a runaway loop.
    perToken: RateLimiter.perWindow(600, 10 * 60 * 1000),
  });

export type Refuse = (status: number, message: string, headers?: Record<string, string>) => Response;

export type BearerAuth = { ok: true; caller: McpCaller; token: string } | { ok: false; response: Response };

/**
 * Checks an MCP token from the Authorization header, with the rate limits for wrong tokens and
 * per token. `refuse` shapes the error for the endpoint (JSON-RPC for MCP, plain JSON elsewhere).
 */
export async function authenticateBearer(request: Request, refuse: Refuse): Promise<BearerAuth> {
  const ip = clientIpFrom(request.headers, env().TRUSTED_PROXIES, env().TRUST_CLOUDFLARE);
  const { probe, perToken } = limits();
  if (!probe.take(rateKey(ip)))
    return { ok: false, response: refuse(429, "Too many requests with a wrong token; try again later.") };
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const caller = token ? await findMcpToken(token) : null;
  if (!token || !caller)
    return {
      ok: false,
      response: refuse(401, "Missing or unknown MCP token. Create one under Settings → Account → MCP.", {
        "WWW-Authenticate": 'Bearer realm="Observator"',
      }),
    };
  probe.reset(rateKey(ip));
  if (!perToken.take(caller.tokenId))
    return {
      ok: false,
      response: refuse(429, "Rate limit for this token reached; try again in a few minutes."),
    };
  await touchMcpToken(caller, ip);
  return { ok: true, caller, token };
}
