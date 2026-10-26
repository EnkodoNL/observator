// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { evaluateAll } from "@/lib/issues/evaluate";
import { refreshRuntimes } from "@/lib/runtimes";
import { publish } from "@/lib/notify/publish";
import { sendDigestIfDue } from "@/lib/notify/digest";
import { processQueue } from "@/lib/notify/queue";
import { sendReminders } from "@/lib/notify/reminders";
import { refreshLatest } from "@/lib/npm-latest";
import { checkAllProjects } from "@/lib/osv/check";
import { reportSelf } from "@/lib/self-report";
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
  /** New runtime releases (security!) are picked up within the hour. Also re-evaluates staleness. */
  "runtime-releases": {
    label: "Runtime release check",
    intervalMs: HOUR,
    lockTtlMs: 10 * MINUTE,
    run: async () => {
      await refreshRuntimes();
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
  /** Newest published versions of direct dependencies, for the "outdated" labels. Display only. */
  "npm-latest": {
    label: "Latest versions of direct dependencies",
    intervalMs: DAY,
    lockTtlMs: 30 * MINUTE,
    run: async () => {
      await refreshLatest();
    },
  },
  /** Observator itself, as a project: forced at every start (see scheduler), then daily. */
  "self-report": {
    label: "Observator reporting on itself",
    intervalMs: DAY,
    lockTtlMs: 10 * MINUTE,
    run: async () => {
      const result = await reportSelf();
      if (result !== "unchanged") console.info(`[self-report] ${result}`);
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
