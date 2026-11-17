// SPDX-License-Identifier: FSL-1.1-ALv2
import { compareVersions } from "@/lib/runtimes/endoflife/evaluate";
import type { Runtime } from "@/lib/runtimes/types";
import { EMBEDDED_RUNTIMES, IMAGE_PRODUCTS, IMAGE_SOURCES } from "./products";
import type { ImageRef } from "./reference";

/** One image of a Coolify database or service, as Observator understands it. */
export interface ImageInventory {
  /** As Coolify has it. */
  ref: string;
  /** "mariadb", "ghcr.io/acme/app" */
  name: string;
  tag: string;
  /** endoflife.date product, when the image is one Observator checks. */
  product: string | null;
  /** The tag (or a digest) fixes the exact version; a moving tag ("11", "latest") does not. */
  pinned: boolean;
  /** What is recorded: the exact version when pinned, otherwise only the line ("11.8"). */
  version: string | null;
  /** What the tag points to now, from the registry; what runs may be older for a moving tag. */
  versionNow: string | null;
  /** Runtimes inside the image (Node, Python, ...), from its environment. */
  runtimes: Runtime[];
  /** owner/repo on GitHub, from the image's label, its GHCR path or a known table. */
  source: string | null;
  /** Why the registry could not be read, if it could not. */
  error: string | null;
}

/** The leading version in a tag or env value: "16-alpine" → "16", "1:11.8.9+maria~ubu2404" → "11.8.9". */
export function versionIn(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = /^(?:\d+:)?v?(\d+(?:\.\d+){0,3})/.exec(value.trim());
  return m ? m[1] : null;
}

const depth = (v: string) => v.split(".").length;
const same = (a: string, b: string) => depth(a) === depth(b) && compareVersions(a, b) === 0;
/** "11.8.9" → "11.8", "16.4" → "16". */
const lineOf = (v: string) => (depth(v) > 1 ? v.split(".").slice(0, -1).join(".") : v);

function sourceOf(ref: ImageRef, labels: Record<string, string>): string | null {
  const label = labels["org.opencontainers.image.source"] ?? "";
  const github = /^(?:https?:\/\/|git@)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
    label.trim(),
  );
  if (github) return `${github[1]}/${github[2]}`.toLowerCase();
  if (ref.registry === "ghcr.io") {
    const [owner, repo] = ref.repository.split("/");
    if (owner && repo) return `${owner}/${repo}`;
  }
  return IMAGE_SOURCES[ref.name] ?? null;
}

/** What an image is, from its reference and (when the registry answered) its config. */
export function describeImage(
  ref: ImageRef,
  config: { labels: Record<string, string>; env: Record<string, string> } | null,
  error: string | null = null,
): ImageInventory {
  const labels = config?.labels ?? {};
  const env = config?.env ?? {};
  const rule = IMAGE_PRODUCTS[ref.name] ?? null;
  const tagVersion = versionIn(ref.tag);
  const fromEnv = rule?.env.map((k) => versionIn(env[k])).find(Boolean) ?? null;
  const versionNow = fromEnv ?? versionIn(labels["org.opencontainers.image.version"]);
  const pinned =
    ref.digest !== null ||
    (tagVersion !== null && (versionNow ? same(tagVersion, versionNow) : depth(tagVersion) >= 3));
  const version = pinned ? (versionNow ?? tagVersion) : versionNow ? lineOf(versionNow) : tagVersion;
  const runtimes = Object.entries(EMBEDDED_RUNTIMES).flatMap(([key, name]) => {
    const v = versionIn(env[key]);
    return v && name !== rule?.product ? [{ name, version: v }] : [];
  });
  return {
    ref: ref.raw,
    name: ref.name,
    tag: ref.digest ? `${ref.tag}@${ref.digest.slice(0, 19)}` : ref.tag,
    product: rule?.product ?? null,
    pinned,
    version,
    versionNow,
    runtimes,
    source: sourceOf(ref, labels),
    error,
  };
}
