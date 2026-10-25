// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { evaluateAll } from "@/lib/issues/evaluate";
import { refreshNodeData } from "@/lib/node/releases";
import { publish } from "@/lib/notify/publish";
import { sendDigestIfDue } from "@/lib/notify/digest";
import { processQueue } from "@/lib/notify/queue";
import { sendReminders } from "@/lib/notify/reminders";
import { checkAllProjects } from "@/lib/osv/check";
import { cleanup } from "./cleanup";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Job {
  intervalMs: number;
  lockTtlMs: number;
  label: string;
  run: () => Promise<void>;
}

export const JOBS = {
  /** New Node releases (security!) are picked up within the hour. Also re-evaluates staleness. */
  "node-index": {
    label: "Node release check",
    intervalMs: HOUR,
    lockTtlMs: 10 * MINUTE,
    run: async () => {
      await refreshNodeData();
      await publish(await evaluateAll());
    },
  },
  /** Advisories are published for old versions too, so every package in use is re-checked daily. */
  "osv-recheck": {
    label: "Package advisory re-check",
    intervalMs: DAY,
    lockTtlMs: 30 * MINUTE,
    run: async () => {
      await checkAllProjects();
      await publish(await evaluateAll());
    },
  },
  /** Retries for notifications that could not be delivered right away. */
  "notify-queue": {
    label: "Notification retries",
    intervalMs: 30_000,
    lockTtlMs: 10 * MINUTE,
    run: processQueue,
  },
  "weekly-digest": {
    label: "Weekly digest",
    intervalMs: 10 * MINUTE,
    lockTtlMs: 5 * MINUTE,
    run: async () => {
      await sendDigestIfDue();
    },
  },
  reminders: {
    label: "Reminders for open issues",
    intervalMs: DAY,
    lockTtlMs: 10 * MINUTE,
    run: async () => {
      await sendReminders();
    },
  },
  cleanup: {
    label: "Cleanup",
    intervalMs: DAY,
    lockTtlMs: 30 * MINUTE,
    run: cleanup,
  },
} satisfies Record<string, Job>;

export type JobName = keyof typeof JOBS;
