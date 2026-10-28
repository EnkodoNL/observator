// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * In the Node.js server process (not during build, not on edge): prints the setup code on a fresh
 * install, encrypts stored secrets under SECRETS_KEY and starts the periodic checks. The import
 * sits inside the runtime check so the edge build leaves the Node-only code out.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNode } = await import("./instrumentation-node");
    await startNode();
  }
}
