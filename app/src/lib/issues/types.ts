// SPDX-License-Identifier: FSL-1.1-ALv2
import type { ResourceInventory } from "@/lib/coolify/inventory";

/** issues.data for kind "vuln". */
export interface VulnIssueData {
  /** OSV ecosystem; absent on issues from before ecosystems were recorded (all npm). */
  ecosystem?: string;
  package: string;
  version: string;
  osvId: string;
  aliases: string[];
  summary: string;
  fixedIn: string;
  url: string;
  direct: boolean;
  dev: boolean;
  via: string[];
}

/**
 * The image a runtime comes from, for a Coolify database or service: there the fix is a new
 * image in Coolify, not a pin in a Dockerfile. embedded: the runtime runs inside the image (Node
 * in an app's image), so the image needs a newer release rather than another tag of the runtime.
 */
export interface ResourceImage {
  name: string;
  embedded: boolean;
  /**
   * For a runtime inside an app's image: the app's newest release, when the image already runs
   * it. A newer runtime then comes with the app's next release; until then there is nothing to do.
   */
  upstream?: string;
}

/** Per runtime, the image of a database or service it comes from: its product, or what runs inside. */
export function resourceImages(
  inventory: Pick<ResourceInventory, "images" | "apps"> | null,
): Record<string, ResourceImage> {
  const images: Record<string, ResourceImage> = {};
  for (const image of inventory?.images ?? []) {
    if (image.product) images[image.product] = { name: image.name, embedded: false };
    // An app already on its newest release: a newer runtime inside comes with its next one.
    const app = inventory?.apps?.find((a) => a.part === image.part && a.source === image.source);
    const upstream = app?.version && app.version === app.latest ? app.version : null;
    for (const r of image.runtimes)
      images[r.name] ??= { name: image.name, embedded: true, ...(upstream ? { upstream } : {}) };
  }
  return images;
}

/** issues.data for kind "runtime_security". */
export interface RuntimeSecurityData {
  runtime: string;
  running: string;
  target: string;
  /** The release line: "22" for Node. */
  line: string;
  securityReleases: string[];
  /** /etc/os-release ID of the reporting image, to pick the image tag to pin. */
  os: string;
  /** For a Coolify database or service: the image to change. */
  image?: ResourceImage;
}

/** issues.data for kind "runtime_eol". */
export interface RuntimeEolData {
  runtime: string;
  running: string;
  line: string;
  end: string;
  phase: "soon" | "eol";
  /** For a Coolify database or service: the image to change. */
  image?: ResourceImage;
}

/**
 * issues.data for kind "stale". "age": no report for staleDays and nothing that says why;
 * "deploy": Coolify deployed after the last report and no report came. Issues from before the
 * reason have none and are "age".
 */
export interface StaleData {
  lastBuildAt: string;
  days: number;
  reason?: "age" | "deploy";
  /** The silent deployment, for "deploy". */
  deploy?: { at: string; commit: string | null };
}

export const staleReason = (data: unknown): "age" | "deploy" =>
  (data as Partial<StaleData> | null)?.reason === "deploy" ? "deploy" : "age";

/** A vuln issue covers every installed version of the package with that advisory. */
export function vulnVersions(d: Pick<VulnIssueData, "version">): string[] {
  return d.version.split(", ").filter(Boolean);
}
