// SPDX-License-Identifier: FSL-1.1-ALv2
import { LockfileError, type Component } from "./types";

/** What the reporter writes for the Go programs in an image (reporter/gobin.go). */
export const GO_BINARIES = "go-binaries.json";

/** OSV's ecosystem name for Go modules. */
export const GO_ECOSYSTEM = "Go";

const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~/+-]{0,511}$/;
const MODULE_VERSION = /^v[0-9A-Za-z.+_-]{1,128}$/;
const MAX_MODULES = 5000;

export interface GoResult {
  /** The main module of the first program, such as github.com/acme/api/cmd/server. */
  main: string;
  /** Its version, when it was built from a tagged module rather than from source. */
  version: string;
  components: Component[];
}

/**
 * The modules linked into the image's Go programs. A binary does not record which modules
 * are direct dependencies, so none is marked direct; the fix is `go get` either way.
 */
export function parseGoBinaries(text: string): GoResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LockfileError(`${GO_BINARIES} is not valid JSON`);
  }
  const binaries = (value as { binaries?: unknown })?.binaries;
  if (!Array.isArray(binaries)) throw new LockfileError(`${GO_BINARIES} has no binaries`);

  const components = new Map<string, Component>();
  let main = "";
  let version = "";
  for (const b of binaries as { main?: unknown; version?: unknown; modules?: unknown }[]) {
    if (!main && typeof b?.main === "string" && MODULE_PATH.test(b.main)) {
      main = b.main;
      version = typeof b.version === "string" && MODULE_VERSION.test(b.version) ? b.version : "";
    }
    for (const m of Array.isArray(b?.modules) ? (b.modules as { path?: unknown; version?: unknown }[]) : []) {
      if (typeof m?.path !== "string" || typeof m.version !== "string") continue;
      if (!MODULE_PATH.test(m.path) || !MODULE_VERSION.test(m.version)) continue;
      const key = `${m.path}@${m.version}`;
      if (components.has(key)) continue;
      if (components.size >= MAX_MODULES) throw new LockfileError(`more than ${MAX_MODULES} Go modules`);
      components.set(key, {
        name: m.path,
        version: m.version,
        direct: false,
        dev: false,
        via: [],
        ecosystem: GO_ECOSYSTEM,
      });
    }
  }
  return {
    main,
    version,
    components: [...components.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    ),
  };
}

/** The project name for a Go app without OBSERVATOR_PROJECT: the last part of its module path. */
export function goAppName(main: string): string {
  return main.split("/").filter(Boolean).at(-1) ?? "";
}
