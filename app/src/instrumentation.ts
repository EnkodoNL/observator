// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * In the Node.js server process (not during build, not on edge): prints the setup code on a fresh
 * install and starts the periodic checks.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // A fresh install prints the code for its first account; PocketBase may still be starting.
  import("./lib/auth/setup-code").then((m) => m.announceSetupCode()).catch(() => undefined);
  if (/^(off|false|0)$/i.test(process.env.OBSERVATOR_JOBS ?? "")) {
    console.info("[jobs] disabled by OBSERVATOR_JOBS");
    return;
  }
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler();
}
