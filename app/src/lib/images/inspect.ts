// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { kvGet, kvSet } from "@/lib/kv";
import { OutboundError } from "@/lib/outbound";
import { describeImage, type ImageInventory } from "./describe";
import { parseImageRef } from "./reference";
import { fetchImageConfig, RegistryError, type ImageConfig } from "./registry";

const HOUR = 3600 * 1000;

/**
 * What an image reference is, with its config read from the registry at most once a day (an
 * error once an hour). Null for a reference that cannot be parsed.
 */
export async function inspectImage(raw: string): Promise<ImageInventory | null> {
  const ref = parseImageRef(raw);
  if (!ref) return null;
  const key = `image:${ref.raw}`;
  const cached = await kvGet<{ config: ImageConfig | null; error: string | null }>(key);
  if (cached) return describeImage(ref, cached.config, cached.error);
  try {
    const config = await fetchImageConfig(ref);
    await kvSet(key, { config, error: null }, new Date(Date.now() + 24 * HOUR));
    return describeImage(ref, config);
  } catch (err) {
    const error =
      err instanceof RegistryError || err instanceof OutboundError
        ? err.message
        : err instanceof Error && err.name === "TimeoutError"
          ? "the registry timed out"
          : "the registry is unreachable";
    await kvSet(key, { config: null, error }, new Date(Date.now() + HOUR));
    return describeImage(ref, null, error);
  }
}
