// SPDX-License-Identifier: FSL-1.1-ALv2
import { gunzipSync } from "node:zlib";
import { parseLabels } from "@/lib/labels";
import { LOCKFILE_NAMES, type LockfileName } from "@/lib/lockfile";
import { runtimeLabel } from "@/lib/runtimes/labels";
import type { Runtime } from "@/lib/runtimes/types";
import { readTar, TarError } from "./tar";

export class IngestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// A large monorepo lockfile is a few MB; this leaves room and keeps one report's memory bounded.
const MAX_UNPACKED = 16 * 1024 * 1024;
const ACCEPTED = new Set<string>(["package.json", ...LOCKFILE_NAMES]);

export interface IngestMeta {
  /** X-Runtime, in the order reported; empty when the image has none Observator recognizes. */
  runtimes: Runtime[];
  /** X-Runtime entries that could not be read, for a warning in the build log. */
  invalidRuntimes: string[];
  platform: string;
  arch: string;
  os: string;
  failOn: FailOn;
  /** OBSERVATOR_LABELS; null when the header is absent (older snippets), so labels stay. */
  labels: { labels: string[]; invalid: string[] } | null;
}

export interface FailOn {
  severity: "low" | "moderate" | "high" | "critical" | null;
  /** Fail on a security update for these runtimes; "*" for any ("runtime"). */
  runtimes: string[];
}

export interface IngestFiles {
  /** Null when the image has no package.json: then there are no packages, only runtimes. */
  packageJson: string | null;
  lockfiles: Partial<Record<LockfileName, string>>;
}

/** Reads the request body with a hard cap, without trusting Content-Length. */
export async function readBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new IngestError(413, `report too large (max ${maxBytes} bytes)`);
  // An empty body is a report without files: an image with runtimes but no package manifest.
  if (!request.body) return Buffer.alloc(0);

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
  return Buffer.concat(chunks);
}

const isGzip = (b: Buffer) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * The Alpine snippet base64-encodes the archive because BusyBox wget truncates binary
 * --post-file bodies at the first NUL byte. Accept both raw and base64 gzip.
 */
export function decodeBody(body: Buffer): Buffer {
  if (isGzip(body)) return body;
  const text = body.toString("latin1").trim();
  if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const decoded = Buffer.from(text, "base64");
    if (isGzip(decoded)) return decoded;
  }
  throw new IngestError(400, "body is not gzip");
}

/** Unpacks the tar.gz in memory and keeps only the expected top-level files. */
export function extractFiles(body: Buffer): IngestFiles {
  if (body.length === 0) return { packageJson: null, lockfiles: {} };
  let archive: Buffer;
  try {
    archive = gunzipSync(decodeBody(body), { maxOutputLength: MAX_UNPACKED });
  } catch (err) {
    if (err instanceof IngestError) throw err;
    const tooBig = err instanceof RangeError || String(err).includes("maxOutputLength");
    throw new IngestError(tooBig ? 413 : 400, tooBig ? "report too large when unpacked" : "body is not gzip");
  }

  let entries;
  try {
    entries = readTar(archive, (name) => ACCEPTED.has(name.replace(/^(\.\/)+/, "")));
  } catch (err) {
    throw new IngestError(400, err instanceof TarError ? err.message : "invalid tar archive");
  }

  const files = new Map<string, string>();
  for (const entry of entries) {
    const name = entry.name.replace(/^(\.\/)+/, "");
    if (!ACCEPTED.has(name) || files.has(name)) continue;
    files.set(name, entry.data.toString("utf8"));
  }

  const packageJson = files.get("package.json") ?? null;
  const lockfiles: IngestFiles["lockfiles"] = {};
  for (const name of LOCKFILE_NAMES) {
    const content = files.get(name);
    if (content !== undefined) lockfiles[name] = content;
  }
  return { packageJson, lockfiles };
}

const SEVERITY_TOKENS = ["low", "moderate", "high", "critical"] as const;

/** Severities for package advisories, "runtime" for any runtime, or a runtime name ("node"). */
export function parseFailOn(value: string | null): FailOn {
  const out: FailOn = { severity: null, runtimes: [] };
  for (const token of (value ?? "").toLowerCase().split(/[\s,]+/)) {
    if (token === "runtime") out.runtimes.push("*");
    else if (token && runtimeLabel(token) !== token) out.runtimes.push(token);
    else if (token === "medium") out.severity = "moderate";
    else if ((SEVERITY_TOKENS as readonly string[]).includes(token))
      out.severity = token as FailOn["severity"];
  }
  return out;
}

const RUNTIME_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const RUNTIME_VERSION = /^[0-9A-Za-z.+_-]{1,64}$/;
const MAX_RUNTIMES = 8;

/** "node/22.11.0, python/3.12.4": name/version pairs, lowercase names, the first of each kept. */
export function parseRuntimes(header: string): { runtimes: Runtime[]; invalid: string[] } {
  const runtimes: Runtime[] = [];
  const invalid: string[] = [];
  for (const entry of header
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const slash = entry.indexOf("/");
    const name = entry.slice(0, slash).toLowerCase();
    // "v22.11.0" from node -v is the same version as "22.11.0".
    const version = entry.slice(slash + 1).replace(/^v(?=\d)/, "");
    if (slash < 1 || !RUNTIME_NAME.test(name) || !RUNTIME_VERSION.test(version))
      invalid.push(entry.slice(0, 80));
    else if (runtimes.length >= MAX_RUNTIMES) invalid.push(entry.slice(0, 80));
    else if (!runtimes.some((r) => r.name === name)) runtimes.push({ name, version });
  }
  return { runtimes, invalid };
}

const ARCH: Record<string, string> = {
  x64: "amd64",
  x86_64: "amd64",
  amd64: "amd64",
  arm64: "arm64",
  aarch64: "arm64",
  arm: "arm",
  armv7: "arm",
  armv7l: "arm",
  ia32: "386",
  i386: "386",
  i686: "386",
};

/**
 * "linux/x86_64" (uname) or "linux/x64" (Node) both become linux/amd64, the names Docker uses,
 * so one machine shows one architecture whatever reported it.
 */
export function normalizePlatform(header: string): { platform: string; arch: string } {
  const value = header.trim().toLowerCase();
  if (!/^[a-z0-9]+\/[a-z0-9_]+$/.test(value)) return { platform: "", arch: "" };
  const [platform, arch] = value.split("/");
  return { platform, arch: ARCH[arch] ?? arch };
}

export function parseMeta(headers: Headers): IngestMeta {
  const runtimeHeader = headers.get("x-runtime");
  if (runtimeHeader === null) {
    throw new IngestError(
      400,
      headers.has("x-node-version")
        ? "this Observator snippet is outdated; replace it with the current one (the project's Setup tab, or setup_dockerfile over MCP)"
        : "missing X-Runtime header",
    );
  }
  const { runtimes, invalid } = parseRuntimes(runtimeHeader.slice(0, 1000));
  const { platform, arch } = normalizePlatform(headers.get("x-platform") ?? "");

  const osHeader = headers.get("x-os")?.trim().toLowerCase() ?? "";
  const os = /^[a-z0-9._-]{1,32}$/.test(osHeader) ? osHeader : "";

  const labelHeader = headers.get("x-labels");
  return {
    runtimes,
    invalidRuntimes: invalid,
    platform,
    arch,
    os,
    failOn: parseFailOn(headers.get("x-fail-on")),
    labels: labelHeader === null ? null : parseLabels(labelHeader.slice(0, 2000)),
  };
}
