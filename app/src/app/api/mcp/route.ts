// SPDX-License-Identifier: FSL-1.1-ALv2
import { originValidationResponse } from "@modelcontextprotocol/server";
import { clientIpFrom, rateKey } from "@/lib/client-ip";
import { findMcpToken, touchMcpToken } from "@/lib/data/mcp-tokens";
import { env } from "@/lib/env";
import { mcpHandler } from "@/lib/mcp/server";
import { RateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const g = globalThis as typeof globalThis & { __mcpLimits?: { probe: RateLimiter; perToken: RateLimiter } };
const limits = () =>
  (g.__mcpLimits ??= {
    // Wrong tokens per address; a correct one resets it.
    probe: RateLimiter.perWindow(30, 10 * 60 * 1000),
    // Generous for an agent going through many projects, a ceiling for a runaway loop.
    perToken: RateLimiter.perWindow(600, 10 * 60 * 1000),
  });

const refuse = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, { status, headers });

/**
 * MCP endpoint for Claude Code and other clients, with a personal token from Settings → Account
 * as bearer. Excluded from proxy.ts: MCP clients send no session cookie.
 */
async function handle(request: Request): Promise<Response> {
  // Browsers on other sites must not reach it; CLI clients send no Origin at all.
  const rejected = originValidationResponse(request, [new URL(env().APP_URL).hostname]);
  if (rejected) return rejected;

  const ip = clientIpFrom(request.headers, env().TRUSTED_PROXIES, env().TRUST_CLOUDFLARE);
  const { probe, perToken } = limits();
  if (!probe.take(rateKey(ip))) return refuse(429, "Too many requests with a wrong token; try again later.");
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const caller = bearer ? await findMcpToken(bearer) : null;
  if (!caller)
    return refuse(401, "Missing or unknown MCP token. Create one under Settings → Account → MCP.", {
      "WWW-Authenticate": 'Bearer realm="Observator"',
    });
  probe.reset(rateKey(ip));
  if (!perToken.take(caller.tokenId))
    return refuse(429, "Rate limit for this token reached; try again in a few minutes.");
  await touchMcpToken(caller, ip);

  return mcpHandler().fetch(request, {
    authInfo: {
      token: bearer!,
      clientId: caller.tokenId,
      scopes: caller.canWrite ? ["read", "write"] : ["read"],
      extra: { caller },
    },
  });
}

export { handle as DELETE, handle as GET, handle as POST };
