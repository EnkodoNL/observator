// SPDX-License-Identifier: FSL-1.1-ALv2
import { formatDate } from "@/lib/time";
import { pinnedGoImage } from "./go/advice";
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
export const CHECKED_RUNTIMES = ["node", "go"];

export const runtimeLabel = (name: string) => LABELS[name] ?? name;

const PINS: Record<string, (version: string, os: string) => string> = {
  node: pinnedImage,
  go: (version) => pinnedGoImage(version),
};

/** The image tag to pin for a version ("node:22.23.4-alpine"), or null when there is no advice. */
export const pinFor = (runtime: string, version: string, os: string): string | null =>
  PINS[runtime]?.(version, os) ?? null;

/**
 * The stage the pin goes in, for "FROM <pin> AS <stage>": Node runs in the final image, Go is
 * compiled into the program in a build stage.
 */
export const pinStage = (runtime: string): string => (runtime === "go" ? "build" : "app");

/** "FROM node:22.23.4-alpine AS app", or null when there is no pin advice for the runtime. */
export function pinLine(runtime: string, version: string, os: string): string | null {
  const pin = pinFor(runtime, version, os);
  return pin ? `FROM ${pin} AS ${pinStage(runtime)}` : null;
}

/** Why and where to pin, per runtime. */
export const pinAdvice = (runtime: string): string =>
  runtime === "go"
    ? "Pin the golang image in the stage that builds the program, keeping your -alpine or -bookworm suffix, and rebuild without cache: Go is compiled into the binary."
    : "Pin the image and redeploy: rebuilding a floating tag often reuses a cached base image.";

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
