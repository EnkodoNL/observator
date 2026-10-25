// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import PocketBase from "pocketbase";
import { env } from "@/lib/env";

type AdminState = { client: PocketBase; login: Promise<unknown> | null };

const g = globalThis as typeof globalThis & { __observatorAdmin?: AdminState };

/**
 * Superuser client shared by the whole process. PocketBase is only reachable from this
 * server, and every collection is superuser-only, so this is the single data access path.
 */
export async function adminPb(): Promise<PocketBase> {
  if (!g.__observatorAdmin) {
    const client = new PocketBase(env().PB_URL);
    client.autoCancellation(false);
    g.__observatorAdmin = { client, login: null };
  }
  const state = g.__observatorAdmin;
  if (!state.client.authStore.isValid) {
    state.login ??= state.client
      .collection("_superusers")
      .authWithPassword(env().PB_SUPERUSER_EMAIL, env().PB_SUPERUSER_PASSWORD, {
        autoRefreshThreshold: 30 * 60,
      })
      .finally(() => {
        state.login = null;
      });
    await state.login;
  }
  return state.client;
}

/** A fresh unauthenticated client, for user auth calls that must not touch the admin store. */
export function userPb(token?: string): PocketBase {
  const client = new PocketBase(env().PB_URL);
  client.autoCancellation(false);
  if (token) client.authStore.save(token, null);
  return client;
}

export function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && err.status === 404;
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("response" in err)) return false;
  const data = (err as { response?: { data?: Record<string, { code?: string }> } }).response?.data;
  return Object.values(data ?? {}).some((f) => f?.code === "validation_not_unique");
}

/** PocketBase returns dates as "2026-10-25 13:00:48.109Z"; empty dates as "". */
export function pbDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toPbDate(d: Date): string {
  return d.toISOString().replace("T", " ");
}
