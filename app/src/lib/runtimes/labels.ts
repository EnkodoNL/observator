// SPDX-License-Identifier: FSL-1.1-ALv2
import { formatDate } from "@/lib/time";
import { pinnedImage } from "./node/advice";
import type { Runtime, RuntimeEvaluation } from "./types";

/**
 * Display names, also for runtimes without release checks. Kept apart from the providers so
 * client components can use them.
 */
const LABELS: Record<string, string> = {
  node: "Node.js",
  bun: "Bun",
  deno: "Deno",
  python: "Python",
  php: "PHP",
  ruby: "Ruby",
  go: "Go",
  java: "Java",
  dotnet: ".NET",
};

/** Runtimes with release checks; the rest is shown as "not checked yet". */
export const CHECKED_RUNTIMES = ["node"];

export const runtimeLabel = (name: string) => LABELS[name] ?? name;

const PINS: Record<string, (version: string, os: string) => string> = { node: pinnedImage };

/** The image tag to pin for a version ("node:22.23.4-alpine"), or null when there is no advice. */
export const pinFor = (runtime: string, version: string, os: string): string | null =>
  PINS[runtime]?.(version, os) ?? null;

/** "node 22.11.0 · python 3.12.4" */
export const formatRuntimes = (runtimes: readonly Runtime[]) =>
  runtimes.map((r) => `${r.name} ${r.version}`).join(" · ");

/** The runtime to lead with: the first that is checked, else the first reported. */
export function primaryRuntime(runtimes: readonly Runtime[] | null | undefined): Runtime | null {
  const list = runtimes ?? [];
  return list.find((r) => CHECKED_RUNTIMES.includes(r.name)) ?? list[0] ?? null;
}

/** "Node.js 22 · Jod · Maintenance LTS until 30 Apr 2027", or null without release data. */
export function lineDescription(evaluation: RuntimeEvaluation | null): string | null {
  if (!evaluation || evaluation.phase === "unknown") return null;
  const name = evaluation.codename ? `${evaluation.codename} · ` : "";
  const until = evaluation.end
    ? evaluation.phase === "eol"
      ? ` since ${formatDate(new Date(evaluation.end))}`
      : ` until ${formatDate(new Date(evaluation.end))}`
    : "";
  return `${evaluation.label} ${evaluation.line} · ${name}${evaluation.phaseLabel}${until}`;
}
