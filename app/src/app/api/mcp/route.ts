// SPDX-License-Identifier: FSL-1.1-ALv2
import { originValidationResponse } from "@modelcontextprotocol/server";
import { authenticateBearer, type Refuse } from "@/lib/bearer-auth";
import { env } from "@/lib/env";
import { mcpHandler } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

const refuse: Refuse = (status, message, headers = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, { status, headers });

/**
 * MCP endpoint for Claude Code and other clients, with a personal token from Settings → Account
 * as bearer. Excluded from proxy.ts: MCP clients send no session cookie.
 */
async function handle(request: Request): Promise<Response> {
  // Browsers on other sites must not reach it; CLI clients send no Origin at all.
  const rejected = originValidationResponse(request, [new URL(env().APP_URL).hostname]);
  if (rejected) return rejected;

  const auth = await authenticateBearer(request, refuse);
  if (!auth.ok) return auth.response;
  const { caller, token } = auth;

  return mcpHandler().fetch(request, {
    authInfo: {
      token,
      clientId: caller.tokenId,
      scopes: caller.canWrite ? ["read", "write"] : ["read"],
      extra: { caller },
    },
  });
}

export { handle as DELETE, handle as GET, handle as POST };
