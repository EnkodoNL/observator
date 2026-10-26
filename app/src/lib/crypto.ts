// SPDX-License-Identifier: FSL-1.1-ALv2
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Shared keys: "obss_" + 256 random bits; one write-only key for many projects. */
export function newSharedKey(): { key: string; hash: string; prefix: string } {
  const key = `obss_${randomToken(32)}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 13) };
}

/** MCP tokens: "obsm_" + 256 random bits; act as their user on /api/mcp. */
export function newMcpToken(): { token: string; hash: string; prefix: string } {
  const token = `obsm_${randomToken(32)}`;
  return { token, hash: sha256(token), prefix: token.slice(0, 13) };
}

/** Project API keys: "obs_" + 256 random bits. Only the sha256 is stored. */
export function newApiKey(): { key: string; hash: string; prefix: string } {
  const key = `obs_${randomToken(32)}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 12) };
}
