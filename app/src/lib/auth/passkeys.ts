// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { env, secureCookies } from "@/lib/env";
import { adminPb, isNotFound, toPbDate } from "@/lib/pb/admin";
import type { PasskeyRecord, UserRecord } from "@/lib/pb/types";

const CHALLENGE_COOKIE = "obs_webauthn";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// The login options are public, so the store has a ceiling instead of growing with every request.
const MAX_PENDING = 5000;

type Pending = { challenge: string; userId?: string; expires: number };
const g = globalThis as typeof globalThis & { __webauthn?: Map<string, Pending> };
const pending = (g.__webauthn ??= new Map());

/** Relying party from APP_URL: the RP ID is the host name, the origin the full origin. */
export function relyingParty() {
  const url = new URL(env().APP_URL);
  return { rpID: url.hostname, origin: url.origin, rpName: "Observator" };
}

async function remember(challenge: string, userId?: string): Promise<void> {
  const id = randomToken(18);
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  if (pending.size >= MAX_PENDING) throw new Error("Too many sign-ins in progress. Try again in a minute.");
  pending.set(id, { challenge, userId, expires: now + CHALLENGE_TTL_MS });
  (await cookies()).set({
    name: CHALLENGE_COOKIE,
    value: id,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    path: "/api/auth/passkey",
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

/** Challenges are single use: taken out of the store whether verification succeeds or not. */
async function takeChallenge(): Promise<Pending | null> {
  const jar = await cookies();
  const id = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete({ name: CHALLENGE_COOKIE, path: "/api/auth/passkey" });
  if (!id) return null;
  const entry = pending.get(id);
  pending.delete(id);
  if (!entry || entry.expires < Date.now()) return null;
  return entry;
}

export async function listPasskeys(userId: string): Promise<PasskeyRecord[]> {
  const pb = await adminPb();
  return pb.collection("passkeys").getFullList<PasskeyRecord>({
    filter: pb.filter("user = {:id}", { id: userId }),
    sort: "-created",
  });
}

export async function registrationOptions(user: Pick<UserRecord, "id" | "email">) {
  const { rpID, rpName } = relyingParty();
  const existing = await listPasskeys(user.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    userID: isoUint8Array.fromUTF8String(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: (p.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await remember(options.challenge, user.id);
  return options;
}

export async function verifyRegistration(
  user: Pick<UserRecord, "id">,
  response: RegistrationResponseJSON,
  name: string,
): Promise<PasskeyRecord> {
  const challenge = await takeChallenge();
  if (!challenge || challenge.userId !== user.id) throw new Error("The passkey request expired. Try again.");
  const { rpID, origin } = relyingParty();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!result.verified) throw new Error("The passkey could not be verified.");
  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  const pb = await adminPb();
  return pb.collection("passkeys").create<PasskeyRecord>({
    user: user.id,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name.trim().slice(0, 100) || "Passkey",
  });
}

export async function authenticationOptions() {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await remember(options.challenge);
  return options;
}

/** Verifies a discoverable-credential login and returns the user it belongs to. */
export async function verifyAuthentication(response: AuthenticationResponseJSON): Promise<string> {
  const challenge = await takeChallenge();
  if (!challenge) throw new Error("The passkey request expired. Try again.");
  const pb = await adminPb();
  let passkey: PasskeyRecord;
  try {
    passkey = await pb
      .collection("passkeys")
      .getFirstListItem<PasskeyRecord>(pb.filter("credentialId = {:id}", { id: response.id }));
  } catch (err) {
    if (isNotFound(err)) throw new Error("This passkey is not registered with Observator.");
    throw err;
  }
  const { rpID, origin } = relyingParty();
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: passkey.credentialId,
      publicKey: isoBase64URL.toBuffer(passkey.publicKey),
      counter: passkey.counter,
      transports: (passkey.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    },
  });
  if (!result.verified) throw new Error("The passkey could not be verified.");
  await pb.collection("passkeys").update(passkey.id, {
    counter: result.authenticationInfo.newCounter,
    lastUsed: toPbDate(new Date()),
  });
  return passkey.user;
}
