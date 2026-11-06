// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { goAppName, parseGoBinaries } from "./go";
import { LockfileError } from "./types";

// As reporter/gobin.go writes it; the modules are onthoud-server's, read from its binary.
const file = (binaries: object[]) => JSON.stringify({ binaries });
const server = {
  path: "/onthoud-server",
  go: "1.26.2",
  main: "github.com/enkodo/onthoud/sync-server",
  modules: [
    { path: "modernc.org/sqlite", version: "v1.61.0" },
    { path: "golang.org/x/net", version: "v0.20.0" },
    { path: "github.com/google/uuid", version: "v1.6.0" },
  ],
};

describe("parseGoBinaries", () => {
  it("turns the modules into Go components, none of them direct", () => {
    const result = parseGoBinaries(file([server]));
    expect(result.main).toBe("github.com/enkodo/onthoud/sync-server");
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
    expect(result.components).toHaveLength(4);
    expect(result).toMatchObject({ main: "github.com/acme/worker", version: "v2.3.0" });
  });

  it("refuses a file that is not what the reporter writes", () => {
    expect(() => parseGoBinaries("{")).toThrow(LockfileError);
    expect(() => parseGoBinaries("{}")).toThrow(/no binaries/);
  });

  it("names a project after the last part of the module path", () => {
    expect(goAppName("github.com/enkodo/onthoud/sync-server")).toBe("sync-server");
    expect(goAppName("")).toBe("");
  });
});
