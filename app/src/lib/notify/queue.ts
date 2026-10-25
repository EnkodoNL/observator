// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { ChannelRecord, NotificationRecord } from "@/lib/pb/types";
import { driverFor } from "./channels";
import type { Message } from "./message";

/** Delay before retry n (1-based). After the last one the notification is marked failed. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];

const CONCURRENCY = 5;

const g = globalThis as typeof globalThis & { __queue?: { running: boolean; again: boolean } };
const state = (g.__queue ??= { running: false, again: false });

async function deliver(n: NotificationRecord): Promise<void> {
  const pb = await adminPb();
  const attempts = n.attempts + 1;
  try {
    const channel = await pb.collection("channels").getOne<ChannelRecord>(n.channel);
    await driverFor(channel.type).send(
      n.payload as Message,
      (channel.config ?? {}) as Record<string, string>,
    );
    await pb
      .collection("notifications")
      .update(n.id, { status: "sent", attempts, sentAt: toPbDate(new Date()), error: "" });
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    const delay = BACKOFF_MS[attempts - 1];
    await pb.collection("notifications").update(n.id, {
      attempts,
      error,
      status: delay === undefined ? "failed" : "pending",
      nextAttemptAt: delay === undefined ? "" : toPbDate(new Date(Date.now() + delay)),
    });
    console.warn(`[notify] ${n.event} via channel ${n.channel} failed (attempt ${attempts}): ${error}`);
  }
}

/** Sends everything that is due. Safe to call often; concurrent calls coalesce. */
export async function processQueue(): Promise<void> {
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.again = false;
      const pb = await adminPb();
      const due = await pb.collection("notifications").getList<NotificationRecord>(1, 50, {
        filter: pb.filter("status = 'pending' && nextAttemptAt <= {:now}", { now: toPbDate(new Date()) }),
        sort: "nextAttemptAt",
      });
      // A slow or dead endpoint must not hold up the other channels.
      for (let i = 0; i < due.items.length; i += CONCURRENCY) {
        await Promise.all(due.items.slice(i, i + CONCURRENCY).map(deliver));
      }
      if (due.totalItems > due.items.length) state.again = true;
    } while (state.again);
  } finally {
    state.running = false;
  }
}
