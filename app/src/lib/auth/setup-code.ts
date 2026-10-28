// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { randomInt } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { kvDelete, kvEnsure, kvGet } from "@/lib/kv";
import { adminPb } from "@/lib/pb/admin";

/*
 * The first account needs a code that only the operator has: it is printed to the web container's
 * log. Without it, whoever reaches /setup first on a fresh install would own it.
 */

const KEY = "setup:code";
// No look-alikes (0/O, 1/I/L), so the code survives being read off a terminal.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Twelve characters in groups of four, such as ABCD-EFGH-JKMN: about 59 bits. */
export function newSetupCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Case, spaces and dashes do not matter when typing it in. */
export const normalizeSetupCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function noUsers(): Promise<boolean> {
  const pb = await adminPb();
  return (await pb.collection("users").getList(1, 1, { fields: "id" })).totalItems === 0;
}

export const setupCodeRequired = () => env().SETUP_CODE;

/** Prints the setup code while there is no account yet; made once and kept until setup is done. */
export async function announceSetupCode(): Promise<void> {
  if (!(await noUsers())) return;
  if (!setupCodeRequired()) {
    console.warn(
      `[setup] No account yet, and SETUP_CODE=off: whoever opens ${env().APP_URL}/setup first creates it`,
    );
    return;
  }
  const code = await kvEnsure(KEY, newSetupCode());
  console.info(`[setup] No account yet. Create it at ${env().APP_URL}/setup with the setup code ${code}`);
}

export async function checkSetupCode(input: string): Promise<boolean> {
  if (!setupCodeRequired()) return true;
  const stored = await kvGet<string>(KEY);
  return Boolean(stored) && safeEqual(normalizeSetupCode(input), normalizeSetupCode(stored!));
}

export const clearSetupCode = () => kvDelete(KEY);
