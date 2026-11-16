// SPDX-License-Identifier: FSL-1.1-ALv2
import { LockfileError, type Component } from "./types";

/** What the reporter writes for the Go programs in an image (reporter/gobin.go). */
export const GO_BINARIES = "go-binaries.json";

/** OSV's ecosystem name for Go modules. */
export const GO_ECOSYSTEM = "Go";

/**
 * Go modules that moved while OSV still lists their advisories under the old path. The version
 * numbers carried on, so the old path's ranges apply. PocketBase left GitHub in v0.41.0.
 */
export const OSV_NAMES: Readonly<Record<string, string>> = {
  "ganigeorgiev.com/pocketbase/pocketbase": "github.com/pocketbase/pocketbase",
};

const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~/+-]{0,511}$/;
const MODULE_VERSION = /^v[0-9A-Za-z.+_-]{1,128}$/;
/** A tagged release: no pseudo-version (a commit), no +dirty or +incompatible. */
const RELEASE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PSEUDO = /(^|[-.])\d{14}-[0-9a-f]{12}$/;
const MAX_MODULES = 5000;

/** Whether a main module's version is a release, as a downloaded program has. */
export const isRelease = (version: string) => RELEASE.test(version) && !PSEUDO.test(version);

export interface GoResult {
  /** The main module of the first program, such as github.com/acme/api/cmd/server. */
  main: string;
  /** Its version, when it was built from a tagged module rather than from source. */
  version: string;
  components: Component[];
}

/**
 * The modules linked into the image's Go programs. A binary does not record which modules are
 * direct dependencies, so none of those is marked direct; the fix is `go get` either way. A
 * program that is itself a release (a downloaded binary such as PocketBase, or `go install
 * x@v1.2.3`) is a component too, the only Go one marked direct: its fix is a newer release. A
 * program built from source here has no release version and is left out.
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
    const ownVersion = typeof b?.version === "string" && MODULE_VERSION.test(b.version) ? b.version : "";
    if (typeof b?.main === "string" && MODULE_PATH.test(b.main)) {
      if (!main) {
        main = b.main;
        version = ownVersion;
      }
      if (isRelease(ownVersion)) {
        components.set(`${b.main}@${ownVersion}`, {
          name: b.main,
          version: ownVersion,
          direct: true,
          dev: false,
          via: [],
          ecosystem: GO_ECOSYSTEM,
        });
      }
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

/** PocketBase's module path: on GitHub until v0.40, ganigeorgiev.com since v0.41.0. */
export function pocketbaseModule(version: string): string {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major === 0 && minor < 41
    ? "github.com/pocketbase/pocketbase"
    : "ganigeorgiev.com/pocketbase/pocketbase";
}

/**
 * A go-binaries.json for a PocketBase release whose binary cannot be read, only its version
 * known: Observator's own PocketBase, which runs in another container. No modules, no Go.
 */
export function pocketbaseBinaries(version: string): string {
  const main = pocketbaseModule(version);
  return JSON.stringify({
    binaries: [{ path: "/pb/pocketbase", main, version: `v${version}`, modules: [] }],
  });
}

/** The project name for a Go app without OBSERVATOR_PROJECT: the last part of its module path. */
export function goAppName(main: string): string {
  return main.split("/").filter(Boolean).at(-1) ?? "";
}
