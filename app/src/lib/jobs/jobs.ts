// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { evaluateAll } from "@/lib/issues/evaluate";
import { refreshNodeData } from "@/lib/node/releases";
import { publish } from "@/lib/notify/publish";
import { checkAllProjects } from "@/lib/osv/check";

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
} satisfies Record<string, Job>;

export type JobName = keyof typeof JOBS;
