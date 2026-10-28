// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";

/*
 * Secrets at rest: deploy webhooks and channel credentials are stored as
 *   enc:v1:<key id>:<iv>:<ciphertext + tag>
 * with AES-256-GCM under SECRETS_KEY. It protects a copy of the database (a backup, a volume
 * snapshot, the PocketBase admin UI), not a compromised web container, which holds the key.
 * The context (such as "projects.deployWebhookToken") is bound as associated data, so a value
 * cannot be moved to another field. Values without the prefix are from before encryption and
 * read as they are, until startup seals them (sealStoredSecrets).
 */

const PREFIX = "enc:v1:";

export class SecretsKeyError extends Error {}

interface Key {
  id: string;
  bytes: Buffer;
}

const toKey = (b64: string): Key => {
  const bytes = Buffer.from(b64, "base64");
  return { id: sha256(bytes).slice(0, 8), bytes };
};

function keys(): { current: Key | null; all: Key[] } {
  const e = env();
  const current = e.SECRETS_KEY ? toKey(e.SECRETS_KEY) : null;
  const previous = e.SECRETS_KEY_PREVIOUS ? toKey(e.SECRETS_KEY_PREVIOUS) : null;
  return { current, all: [current, previous].filter((k): k is Key => k !== null) };
}

export const secretsKeySet = () => keys().current !== null;

export const isSealed = (value: string) => value.startsWith(PREFIX);

/** Whether a stored value is encrypted under the current key (and needs nothing at startup). */
export function isCurrent(value: string): boolean {
  const current = keys().current;
  return Boolean(current) && value.startsWith(`${PREFIX}${current!.id}:`);
}

/** Encrypts a value for storage; empty stays empty. Throws SecretsKeyError without SECRETS_KEY. */
export function seal(value: string, context: string): string {
  if (!value) return "";
  const key = keys().current;
  if (!key) throw new SecretsKeyError("set SECRETS_KEY to store secrets (openssl rand -base64 32)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${key.id}:${iv.toString("base64url")}:${data.toString("base64url")}`;
}

/** The stored value in plain text; values from before encryption come back unchanged. */
export function unseal(stored: string, context: string): string {
  if (!stored || !isSealed(stored)) return stored ?? "";
  const [id, iv, data] = stored.slice(PREFIX.length).split(":");
  const key = keys().all.find((k) => k.id === id);
  if (!key) throw new SecretsKeyError(`a stored secret needs the key ${id}; SECRETS_KEY changed?`);
  const raw = Buffer.from(data ?? "", "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, Buffer.from(iv ?? "", "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString(
    "utf8",
  );
}
