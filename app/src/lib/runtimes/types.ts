// SPDX-License-Identifier: FSL-1.1-ALv2

/** A runtime in an image, as reported in X-Runtime: "node/22.11.0" → { name: "node", version }. */
export interface Runtime {
  name: string;
  version: string;
}

/** Where a release line stands; each provider maps its own lifecycle onto these. */
export type RuntimePhase = "current" | "active" | "maintenance" | "eol" | "unknown";

export interface RuntimeEvaluation {
  runtime: string;
  /** "Node.js" */
  label: string;
  version: string;
  /** The release line the version belongs to: "22" for Node. */
  line: string;
  phase: RuntimePhase;
  /** "Maintenance LTS": the provider's own name for the phase. */
  phaseLabel: string;
  codename: string | null;
  /** End of life of the line, YYYY-MM-DD. */
  end: string | null;
  /** Days until end-of-life; negative once past it. */
  daysToEol: number | null;
  eolSoon: boolean;
  latestInLine: string | null;
  /** Newer releases in this line include security fixes: move to `target`. */
  securityUpdate: { target: string; releases: string[] } | null;
  patchAvailable: boolean;
  /** Newest version on a supported long-term line, for "move to" advice. */
  latestSupported: string | null;
}

/** Evaluates a version against release data that is already loaded. */
export type Evaluator = (version: string, now?: Date) => RuntimeEvaluation;

/**
 * One runtime Observator knows releases for. Adding a language means adding a provider
 * (and, for its packages, a lockfile parser); runtimes without one are shown, not checked.
 */
export interface RuntimeProvider {
  /** As in X-Runtime. */
  name: string;
  label: string;
  /** Downloads release data and caches it; called by the hourly job. */
  refresh(): Promise<void>;
  /** An evaluator over cached data, or null when there is none (offline, first start). */
  evaluator(): Promise<Evaluator | null>;
}
