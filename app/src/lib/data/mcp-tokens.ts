// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { newMcpToken, sha256 } from "@/lib/crypto";
import { adminPb, isNotFound, pbDate, toPbDate } from "@/lib/pb/admin";
import type { McpTokenRecord, UserRecord } from "@/lib/pb/types";

export async function listMcpTokens(userId: string): Promise<McpTokenRecord[]> {
  const pb = await adminPb();
  return pb
    .collection("mcp_tokens")
    .getFullList<McpTokenRecord>({ filter: pb.filter("user = {:u}", { u: userId }), sort: "created" });
}

/** Creates a token and returns it together with the plain value, which is shown once. */
export async function createMcpToken(
  userId: string,
  name: string,
  canWrite: boolean,
): Promise<{ record: McpTokenRecord; token: string }> {
  const pb = await adminPb();
  const { token, hash, prefix } = newMcpToken();
  const record = await pb
    .collection("mcp_tokens")
    .create<McpTokenRecord>({ user: userId, name, tokenHash: hash, tokenPrefix: prefix, canWrite });
  return { record, token };
}

export interface McpCaller {
  tokenId: string;
  tokenPrefix: string;
  canWrite: boolean;
  lastUsedAt: string;
  userId: string;
  email: string;
}

/** The token and its user for a bearer value, or null. */
export async function findMcpToken(bearer: string): Promise<McpCaller | null> {
  if (!bearer.startsWith("obsm_")) return null;
  const pb = await adminPb();
  try {
    const t = await pb
      .collection("mcp_tokens")
      .getFirstListItem<McpTokenRecord & { expand?: { user?: UserRecord } }>(
        pb.filter("tokenHash = {:h}", { h: sha256(bearer) }),
        { expand: "user" },
      );
    const user = t.expand?.user;
    if (!user) return null;
    return {
      tokenId: t.id,
      tokenPrefix: t.tokenPrefix,
      canWrite: t.canWrite,
      lastUsedAt: t.lastUsedAt,
      userId: user.id,
      email: user.email,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Records use, at most once a minute: every MCP call would otherwise write. */
export async function touchMcpToken(caller: McpCaller, ip: string): Promise<void> {
  const last = pbDate(caller.lastUsedAt)?.getTime() ?? 0;
  if (Date.now() - last < 60_000) return;
  const pb = await adminPb();
  await pb
    .collection("mcp_tokens")
    .update(caller.tokenId, { lastUsedAt: toPbDate(new Date()), lastUsedIp: ip });
}

/** Revoking is only possible in the UI: MCP never deletes. */
export async function revokeMcpToken(userId: string, id: string): Promise<void> {
  const pb = await adminPb();
  const token = await pb.collection("mcp_tokens").getOne<McpTokenRecord>(id);
  if (token.user !== userId) throw new Error("Not your token");
  await pb.collection("mcp_tokens").delete(token.id);
}
