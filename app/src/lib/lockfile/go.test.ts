// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { goAppName, isRelease, parseGoBinaries, pocketbaseBinaries, pocketbaseModule } from "./go";
import { LockfileError } from "./types";

// As reporter/gobin.go writes it; the modules are those of a small Go server, read from its binary.
const file = (binaries: object[]) => JSON.stringify({ binaries });
const server = {
  path: "/notes-server",
  go: "1.26.2",
  main: "github.com/example/notes/sync-server",
  modules: [
    { path: "modernc.org/sqlite", version: "v1.61.0" },
    { path: "golang.org/x/net", version: "v0.20.0" },
    { path: "github.com/google/uuid", version: "v1.6.0" },
  ],
};

describe("parseGoBinaries", () => {
  it("turns the modules into Go components, none of them direct", () => {
    const result = parseGoBinaries(file([server]));
    expect(result.main).toBe("github.com/example/notes/sync-server");
    expect(result.version).toBe("");
    expect(result.components.map((c) => `${c.name}@${c.version}`)).toEqual([
      "github.com/google/uuid@v1.6.0",
      "golang.org/x/net@v0.20.0",
      "modernc.org/sqlite@v1.61.0",
    ]);
    expect(result.components[0]).toEqual({
      name: "github.com/google/uuid",
      version: "v1.6.0",
      direct: false,
      dev: false,
      via: [],
      ecosystem: "Go",
    });
  });

  it("merges the programs of one image and skips what is not a module version", () => {
    const worker = {
      main: "github.com/acme/worker",
      version: "v2.3.0",
      modules: [
        { path: "golang.org/x/net", version: "v0.20.0" },
        { path: "golang.org/x/text", version: "v0.43.0" },
        { path: "../local", version: "(devel)" },
        { path: "", version: "v1.0.0" },
      ],
    };
    const result = parseGoBinaries(file([{ ...server, main: 42 }, worker]));
    // Three modules, plus the worker itself: a release.
    expect(result.components).toHaveLength(4 + 1);
    expect(result.components.filter((c) => c.direct).map((c) => c.name)).toEqual(["github.com/acme/worker"]);
    expect(result).toMatchObject({ main: "github.com/acme/worker", version: "v2.3.0" });
  });

  it("checks a downloaded release as the program itself, but not one built from source", () => {
    // A release binary as PocketBase publishes it: the main module has a tag.
    const pocketbase = {
      path: "/pb/pocketbase",
      go: "1.27.4",
      main: "ganigeorgiev.com/pocketbase/pocketbase",
      version: "v0.42.3",
      modules: [{ path: "golang.org/x/net", version: "v0.20.0" }],
    };
    const result = parseGoBinaries(file([pocketbase]));
    expect(result.components).toContainEqual({
      name: "ganigeorgiev.com/pocketbase/pocketbase",
      version: "v0.42.3",
      direct: true,
      dev: false,
      via: [],
      ecosystem: "Go",
    });
    expect(result.components.filter((c) => c.direct)).toHaveLength(1);
    // Built here: no version, a commit or a dirty tree; the program is not a package then.
    for (const version of [undefined, "v0.0.0-20261116101500-0123456789ab", "v1.2.3+dirty"]) {
      const own = parseGoBinaries(file([{ ...server, version }]));
      expect(own.components.some((c) => c.name === server.main)).toBe(false);
    }
  });

  it("tells a release from a commit", () => {
    expect(isRelease("v0.42.3")).toBe(true);
    expect(isRelease("v2.0.0-rc.1")).toBe(true);
    expect(isRelease("v1.3.1-0.20261116101500-0123456789ab")).toBe(false);
    expect(isRelease("v0.0.0-20261116101500-0123456789ab")).toBe(false);
    expect(isRelease("v1.2.3+incompatible")).toBe(false);
    expect(isRelease("")).toBe(false);
  });

  it("knows where PocketBase's module lives per version", () => {
    expect(pocketbaseModule("0.40.6")).toBe("github.com/pocketbase/pocketbase");
    expect(pocketbaseModule("v0.22.57")).toBe("github.com/pocketbase/pocketbase");
    expect(pocketbaseModule("0.41.0")).toBe("ganigeorgiev.com/pocketbase/pocketbase");
    expect(pocketbaseModule("0.42.3")).toBe("ganigeorgiev.com/pocketbase/pocketbase");
  });

  it("describes Observator's own PocketBase as a program to check", () => {
    const own = parseGoBinaries(pocketbaseBinaries("0.42.3"));
    expect(own.components).toEqual([
      {
        name: "ganigeorgiev.com/pocketbase/pocketbase",
        version: "v0.42.3",
        direct: true,
        dev: false,
        via: [],
        ecosystem: "Go",
      },
    ]);
  });

  it("refuses a file that is not what the reporter writes", () => {
    expect(() => parseGoBinaries("{")).toThrow(LockfileError);
    expect(() => parseGoBinaries("{}")).toThrow(/no binaries/);
  });

  it("names a project after the last part of the module path", () => {
    expect(goAppName("github.com/example/notes/sync-server")).toBe("sync-server");
    expect(goAppName("")).toBe("");
  });
});
