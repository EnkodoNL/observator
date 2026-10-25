// SPDX-License-Identifier: FSL-1.1-ALv2
import type { PackageJson } from "@/lib/lockfile";
import { IngestError } from "./request";

const NAME = /^[\x20-\x7e]{1,100}$/;

/**
 * The project name a shared-key report is for: OBSERVATOR_PROJECT (X-Project), otherwise
 * the name from package.json.
 */
export function reportedName(header: string | null, pkg: PackageJson | null): string {
  const explicit = header?.trim() ?? "";
  if (explicit) {
    if (!NAME.test(explicit))
      throw new IngestError(400, "X-Project must be 1-100 printable ASCII characters");
    return explicit;
  }
  const fromPackage = typeof pkg?.name === "string" ? pkg.name.trim() : "";
  if (fromPackage && NAME.test(fromPackage)) return fromPackage;
  throw new IngestError(400, "no project name: set OBSERVATOR_PROJECT, or a name in package.json");
}

/**
 * The address the report came from. Behind a reverse proxy (Coolify's Traefik) that is the
 * first X-Forwarded-For entry; without one, Next.js fills that header with the socket address.
 */
export function sourceIp(headers: Headers): string {
  const raw = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  const ip = raw.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "unknown";
}

/** How an auto-created project is shown: the reported name, plus the server when split by IP. */
export function displayName(name: string, instance: string): string {
  return instance ? `${name} · ${instance}` : name;
}
