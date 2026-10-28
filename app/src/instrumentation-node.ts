// SPDX-License-Identifier: FSL-1.1-ALv2
import { announceSetupCode } from "./lib/auth/setup-code";
import { sealStoredSecrets } from "./lib/secrets-at-rest";

/** Startup in the Node.js server process; imported by instrumentation.ts only on that runtime. */
export async function startNode(): Promise<void> {
  // A fresh install prints the code for its first account; PocketBase may still be starting.
  announceSetupCode().catch(() => undefined);
  void sealSecretsWhenReady();
  if (/^(off|false|0)$/i.test(process.env.OBSERVATOR_JOBS ?? "")) {
    console.info("[jobs] disabled by OBSERVATOR_JOBS");
    return;
  }
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler();
}

/** Retries for a minute, in case PocketBase is not up yet when the server starts. */
async function sealSecretsWhenReady(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await sealStoredSecrets();
      return;
    } catch (err) {
      if (attempt === 6) return console.error("[secrets] startup check failed", err);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}
