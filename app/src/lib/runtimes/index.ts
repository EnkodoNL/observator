// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { node } from "./node";
import type { Evaluator, Runtime, RuntimeEvaluation, RuntimeProvider } from "./types";

export type { Runtime, RuntimeEvaluation, RuntimeProvider } from "./types";
export { pinFor, runtimeLabel } from "./labels";

/** Runtimes with release checks. Others are reported and shown, not checked. */
export const PROVIDERS: Record<string, RuntimeProvider> = { node };

export const providerFor = (name: string): RuntimeProvider | null => PROVIDERS[name] ?? null;

/** Evaluators per runtime, for the providers that have release data right now. */
export async function loadEvaluators(): Promise<Map<string, Evaluator>> {
  const entries = await Promise.all(
    Object.values(PROVIDERS).map(async (p) => [p.name, await p.evaluator()] as const),
  );
  return new Map(entries.filter((e): e is [string, Evaluator] => e[1] !== null));
}

export function evaluateRuntimes(
  runtimes: readonly Runtime[],
  evaluators: Map<string, Evaluator>,
  now?: Date,
): RuntimeEvaluation[] {
  return runtimes.flatMap((r) => {
    const evaluate = evaluators.get(r.name);
    return evaluate ? [evaluate(r.version, now)] : [];
  });
}

/** Refreshes every provider's release data; one failing does not stop the others. */
export async function refreshRuntimes(): Promise<void> {
  const results = await Promise.allSettled(Object.values(PROVIDERS).map((p) => p.refresh()));
  const failed = results.flatMap((r, i) =>
    r.status === "rejected" ? [`${Object.values(PROVIDERS)[i].name}: ${String(r.reason)}`] : [],
  );
  if (failed.length) throw new Error(`release data: ${failed.join("; ")}`);
}
