// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { runJob } from "@/lib/jobs/scheduler";

/** "Run checks now": runtime releases, OSV and npm latest, one after the other. */
export async function runAllChecks(): Promise<{ ok: boolean; error?: string }> {
  const results = [
    await runJob("runtime-releases", { force: true }),
    await runJob("osv-recheck", { force: true }),
    await runJob("npm-latest", { force: true }),
  ];
  if (results.some((r) => r === null))
    return { ok: false, error: "A check is already running; try again in a minute." };
  const failed = results.find((r) => r && !r.ok);
  return failed ? { ok: false, error: failed.error } : { ok: true };
}
