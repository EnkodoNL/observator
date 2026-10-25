// SPDX-License-Identifier: FSL-1.1-ALv2
import { gunzipSync } from "node:zlib";
import { LOCKFILE_NAMES, type LockfileName } from "@/lib/lockfile";
import { readTar, TarError } from "./tar";

export class IngestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_UNPACKED = 64 * 1024 * 1024;
const ACCEPTED = new Set<string>(["package.json", ...LOCKFILE_NAMES]);

export interface IngestMeta {
  nodeVersion: string;
  platform: string;
  arch: string;
  os: string;
  failOn: FailOn;
}

export interface FailOn {
  severity: "low" | "moderate" | "high" | "critical" | null;
  node: boolean;
}

export interface IngestFiles {
  packageJson: string;
  lockfiles: Partial<Record<LockfileName, string>>;
}

/** Reads the request body with a hard cap, without trusting Content-Length. */
export async function readBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new IngestError(413, `report too large (max ${maxBytes} bytes)`);
  if (!request.body) throw new IngestError(400, "empty body");

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IngestError(413, `report too large (max ${maxBytes} bytes)`);
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) throw new IngestError(400, "empty body");
  return Buffer.concat(chunks);
}

/** Unpacks the tar.gz in memory and keeps only the expected top-level files. */
export function extractFiles(body: Buffer): IngestFiles {
  let archive: Buffer;
  try {
    archive = gunzipSync(body, { maxOutputLength: MAX_UNPACKED });
  } catch (err) {
    const tooBig = err instanceof RangeError || String(err).includes("maxOutputLength");
    throw new IngestError(tooBig ? 413 : 400, tooBig ? "report too large when unpacked" : "body is not gzip");
  }

  let entries;
  try {
    entries = readTar(archive);
  } catch (err) {
    throw new IngestError(400, err instanceof TarError ? err.message : "invalid tar archive");
  }

  const files = new Map<string, string>();
  for (const entry of entries) {
    const name = entry.name.replace(/^(\.\/)+/, "");
    if (!ACCEPTED.has(name) || files.has(name)) continue;
    files.set(name, entry.data.toString("utf8"));
  }

  const packageJson = files.get("package.json");
  if (packageJson === undefined) throw new IngestError(400, "package.json missing from report");
  const lockfiles: IngestFiles["lockfiles"] = {};
  for (const name of LOCKFILE_NAMES) {
    const content = files.get(name);
    if (content !== undefined) lockfiles[name] = content;
  }
  return { packageJson, lockfiles };
}

const SEVERITY_TOKENS = ["low", "moderate", "high", "critical"] as const;

export function parseFailOn(value: string | null): FailOn {
  const out: FailOn = { severity: null, node: false };
  for (const token of (value ?? "").toLowerCase().split(/[\s,]+/)) {
    if (token === "node") out.node = true;
    else if (token === "medium") out.severity = "moderate";
    else if ((SEVERITY_TOKENS as readonly string[]).includes(token))
      out.severity = token as FailOn["severity"];
  }
  return out;
}

export function parseMeta(headers: Headers): IngestMeta {
  const rawVersion = headers.get("x-node-version")?.trim() ?? "";
  const version = /^v?(\d+\.\d+\.\d+)$/.exec(rawVersion)?.[1];
  if (!version)
    throw new IngestError(400, "missing or invalid X-Node-Version header (expected e.g. v22.11.0)");

  const platformHeader = headers.get("x-platform")?.trim().toLowerCase() ?? "";
  const [platform = "", arch = ""] = /^[a-z0-9]+\/[a-z0-9_]+$/.test(platformHeader)
    ? platformHeader.split("/")
    : [];

  const osHeader = headers.get("x-os")?.trim().toLowerCase() ?? "";
  const os = /^[a-z0-9._-]{1,32}$/.test(osHeader) ? osHeader : "";

  return { nodeVersion: version, platform, arch, os, failOn: parseFailOn(headers.get("x-fail-on")) };
}
