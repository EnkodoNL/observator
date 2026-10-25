// SPDX-License-Identifier: FSL-1.1-ALv2

/** Starts the periodic checks in the Node.js server process (not during build, not on edge). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (/^(off|false|0)$/i.test(process.env.OBSERVATOR_JOBS ?? "")) {
    console.info("[jobs] disabled by OBSERVATOR_JOBS");
    return;
  }
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler();
}
