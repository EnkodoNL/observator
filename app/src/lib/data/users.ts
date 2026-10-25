// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { randomToken, sha256 } from "@/lib/crypto";
import { adminPb, isNotFound, pbDate, toPbDate } from "@/lib/pb/admin";
import type { InviteRecord, PasskeyRecord, UserRecord } from "@/lib/pb/types";

export const INVITE_TTL_DAYS = 7;

export async function listUsers(): Promise<
  (Pick<UserRecord, "id" | "email" | "created"> & { passkeys: number; totp: boolean })[]
> {
  const pb = await adminPb();
  const [users, passkeys] = await Promise.all([
    // Only whether a TOTP secret exists; the secret itself never leaves this function.
    pb.collection("users").getFullList<UserRecord & { totpSecret: string }>({
      sort: "created",
      fields: "id,email,created,totpSecret",
    }),
    pb.collection("passkeys").getFullList<PasskeyRecord>({ fields: "user" }),
  ]);
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    created: u.created,
    totp: Boolean(u.totpSecret),
    passkeys: passkeys.filter((p) => p.user === u.id).length,
  }));
}

export async function listInvites(): Promise<InviteRecord[]> {
  const pb = await adminPb();
  return pb.collection("invites").getFullList<InviteRecord>({
    filter: pb.filter("usedAt = '' && expiresAt > {:now}", { now: toPbDate(new Date()) }),
    sort: "-created",
  });
}

/** Creates a single-use invite and returns the plain token; only its hash is stored. */
export async function createInvite(createdBy: string, email: string): Promise<string> {
  const pb = await adminPb();
  const token = randomToken(24);
  await pb.collection("invites").create({
    tokenHash: sha256(token),
    email,
    createdBy,
    expiresAt: toPbDate(new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000)),
  });
  return token;
}

export async function findInvite(token: string): Promise<InviteRecord | null> {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  const pb = await adminPb();
  try {
    const invite = await pb
      .collection("invites")
      .getFirstListItem<InviteRecord>(pb.filter("tokenHash = {:h}", { h: sha256(token) }));
    const expires = pbDate(invite.expiresAt);
    if (invite.usedAt || !expires || expires.getTime() < Date.now()) return null;
    return invite;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function revokeInvite(id: string): Promise<void> {
  const pb = await adminPb();
  await pb.collection("invites").delete(id);
}

export async function markInviteUsed(id: string): Promise<void> {
  const pb = await adminPb();
  await pb.collection("invites").update(id, { usedAt: toPbDate(new Date()) });
}
