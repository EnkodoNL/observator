// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet, tryLock } from "@/lib/kv";
import { JOBS, type JobName } from "./jobs";

const TICK_MS = 30_000;

export interface JobState {
  lastRun: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

const g = globalThis as typeof globalThis & {
  __scheduler?: { timer: NodeJS.Timeout; running: Set<string> };
};

/** Runs one job under the in-process flag and the cross-process kv lock. */
export async function runJob(name: JobName, { force = false } = {}): Promise<JobState | null> {
  const job = JOBS[name];
  const running = g.__scheduler?.running ?? new Set<string>();
  if (running.has(name)) return null;

  if (!force) {
    const state = await kvGet<JobState>(`job:${name}`);
    if (state && Date.now() - Date.parse(state.lastRun) < job.intervalMs) return null;
  }
  const release = await tryLock(`job:${name}`, job.lockTtlMs);
  if (!release) return null;

  running.add(name);
  const started = Date.now();
  let state: JobState;
  try {
    await job.run();
    state = { lastRun: new Date(started).toISOString(), ok: true, durationMs: Date.now() - started };
  } catch (err) {
    console.error(`[jobs] ${name} failed`, err);
    state = {
      lastRun: new Date(started).toISOString(),
      ok: false,
      error: String(err),
      durationMs: Date.now() - started,
    };
  } finally {
    running.delete(name);
    await release();
  }
  await kvSet(`job:${name}`, state);
  return state;
}

async function tick(): Promise<void> {
  for (const name of Object.keys(JOBS) as JobName[]) {
    try {
      await runJob(name);
    } catch (err) {
      console.error(`[jobs] could not schedule ${name}`, err);
    }
  }
}

/** Starts the interval loop once per process. */
export function startScheduler(): void {
  if (g.__scheduler) return;
  const running = new Set<string>();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  g.__scheduler = { timer, running };
  // A new deploy must report its own Node version right away, not up to a day later.
  setTimeout(async () => {
    await runJob("self-report", { force: true }).catch((err) =>
      console.error("[jobs] self-report failed", err),
    );
    await tick();
  }, 5_000).unref();
  console.info("[jobs] scheduler started");
}

export async function jobStates(): Promise<Record<JobName, JobState | null>> {
  const names = Object.keys(JOBS) as JobName[];
  const states = await Promise.all(names.map((n) => kvGet<JobState>(`job:${n}`)));
  return Object.fromEntries(names.map((n, i) => [n, states[i]])) as Record<JobName, JobState | null>;
}
