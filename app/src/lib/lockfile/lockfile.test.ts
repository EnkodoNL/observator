// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseLockfile, LockfileError, parseLockfile, parsePackageJson, type Component } from ".";
import { parsePnpmLock } from "./pnpm";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const pkg = parsePackageJson(fixture("package.json"));

const find = (list: Component[], name: string, version: string) =>
  list.find((c) => c.name === name && c.version === version);

const npm = parseLockfile("package-lock.json", fixture("package-lock.json"), pkg);
const results = {
  npm,
  "yarn v1": parseLockfile("yarn.lock", fixture("yarn-v1.lock"), pkg),
  "yarn berry": parseLockfile("yarn.lock", fixture("yarn-berry.lock"), pkg),
  "pnpm v9": parseLockfile("pnpm-lock.yaml", fixture("pnpm-lock.v9.yaml"), pkg),
  "pnpm v6": parseLockfile("pnpm-lock.yaml", fixture("pnpm-lock.v6.yaml"), pkg),
};

describe.each(Object.entries(results))("%s", (_, result) => {
  const list = result.components;

  it("resolves direct dependencies, including scoped packages and npm: aliases", () => {
    expect(find(list, "lodash", "4.17.20")).toMatchObject({ direct: true, dev: false });
    expect(find(list, "lodash", "4.17.21")).toMatchObject({ direct: true, dev: false });
    expect(find(list, "@sindresorhus/is", "4.6.0")).toMatchObject({ direct: true, dev: false });
    expect(find(list, "react-dom", "18.2.0")).toMatchObject({ direct: true, dev: false });
    expect(find(list, "debug", "4.3.4")).toMatchObject({ direct: true, dev: true });
    expect(find(list, "minimist", "1.2.5")).toMatchObject({ direct: true, dev: true });
    expect(list.some((c) => c.name === "my-lodash")).toBe(false);
  });

  it("classifies transitive packages and records how they are pulled in", () => {
    expect(find(list, "debug", "2.6.9")).toMatchObject({ direct: false, dev: false, via: ["express"] });
    expect(find(list, "ms", "2.1.2")).toMatchObject({ direct: false, dev: true, via: ["debug"] });
    expect(find(list, "ms", "2.0.0")).toMatchObject({ direct: false, dev: false });
    expect(find(list, "scheduler", "0.23.2")?.via).toEqual(["react-dom"]);
    expect(find(list, "loose-envify", "1.4.0")?.via.sort()).toEqual(["react", "react-dom"]);
  });

  it("agrees with npm's own dev flags wherever both resolved the same version", () => {
    // Package managers dedupe differently (yarn and pnpm keep http-errors@1.7.3 next to
    // 1.7.2, npm does not), so compare the classification of the shared packages only.
    const reference = new Map(npm.components.map((c) => [`${c.name}@${c.version}`, c]));
    const shared = list.filter((c) => reference.has(`${c.name}@${c.version}`));
    expect(shared.length).toBeGreaterThan(npm.components.length * 0.95);
    for (const c of shared) {
      const ref = reference.get(`${c.name}@${c.version}`)!;
      expect({ id: `${c.name}@${c.version}`, direct: c.direct, dev: c.dev }).toEqual({
        id: `${ref.name}@${ref.version}`,
        direct: ref.direct,
        dev: ref.dev,
      });
    }
  });
});

describe("lockfile selection", () => {
  it("prefers packageManager, then npm, pnpm, yarn", () => {
    expect(chooseLockfile({ packageManager: "pnpm@9.1.0" }, ["package-lock.json", "pnpm-lock.yaml"])).toBe(
      "pnpm-lock.yaml",
    );
    expect(chooseLockfile({}, ["yarn.lock", "pnpm-lock.yaml"])).toBe("pnpm-lock.yaml");
    expect(chooseLockfile({ packageManager: "yarn@4.0.0" }, ["package-lock.json"])).toBe("package-lock.json");
    expect(chooseLockfile({}, [])).toBeNull();
  });
});

describe("errors", () => {
  it("rejects npm lockfileVersion 1 with a hint", () => {
    expect(() => parseLockfile("package-lock.json", '{"lockfileVersion":1,"dependencies":{}}', {})).toThrow(
      /npm 7 or newer/,
    );
  });

  it("rejects invalid input", () => {
    expect(() => parseLockfile("package-lock.json", "{nope", {})).toThrow(LockfileError);
    expect(() => parsePnpmLock("lockfileVersion: '5.4'\n")).toThrow(/pnpm 8 or newer/);
    expect(() => parsePackageJson("[]")).toThrow(LockfileError);
  });

  it("refuses YAML aliases (billion laughs)", () => {
    const bomb = "lockfileVersion: '9.0'\na: &a [x, x]\nb: [*a, *a]\n";
    expect(() => parsePnpmLock(bomb)).toThrow(LockfileError);
  });
});

describe("workspaces", () => {
  // Root holds the tooling; apps/web needs mariadb and links packages/db, which needs mysql2.
  const pnpmWorkspace = `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      vitest: {specifier: 4.0.0, version: 4.0.0}
  apps/web:
    dependencies:
      mariadb: {specifier: 3.4.5, version: 3.4.5}
      '@x/db': {specifier: workspace:*, version: link:../../packages/db}
  apps/admin:
    dependencies:
      zod: {specifier: 4.3.6, version: 4.3.6}
  packages/db:
    dependencies:
      mysql2: {specifier: 3.15.3, version: 3.15.3}
snapshots:
  vitest@4.0.0:
    dependencies:
      vite: 8.3.1
  vite@8.3.1: {}
  mariadb@3.4.5: {}
  mysql2@3.15.3: {}
  zod@4.3.6: {}
`;
  const root = { devDependencies: { vitest: "4.0.0" } };
  const web = { dependencies: { mariadb: "3.4.5", "@x/db": "workspace:*" } };

  it("pnpm: an image built from the root counts every workspace package's dependencies", () => {
    const list = parseLockfile("pnpm-lock.yaml", pnpmWorkspace, root).components;
    expect(find(list, "mariadb", "3.4.5")).toMatchObject({ direct: true, dev: false });
    expect(find(list, "mysql2", "3.15.3")).toMatchObject({ direct: true, dev: false });
    expect(find(list, "zod", "4.3.6")).toMatchObject({ dev: false });
    expect(find(list, "vite", "8.3.1")).toMatchObject({ direct: false, dev: true, via: ["vitest"] });
  });

  it("pnpm: a package.json that matches one workspace package narrows to it", () => {
    const list = parseLockfile("pnpm-lock.yaml", pnpmWorkspace, web).components;
    expect(find(list, "mariadb", "3.4.5")).toMatchObject({ dev: false });
    expect(find(list, "mysql2", "3.15.3")).toMatchObject({ dev: false });
    expect(find(list, "zod", "4.3.6")).toMatchObject({ dev: true });
    expect(find(list, "vitest", "4.0.0")).toMatchObject({ dev: true });
  });

  const berryWorkspace = `__metadata:
  version: 8

"root@workspace:.":
  version: 0.0.0-use.local
  resolution: "root@workspace:."
  dependencies:
    vitest: "npm:4.0.0"

"web@workspace:apps/web":
  version: 0.0.0-use.local
  resolution: "web@workspace:apps/web"
  dependencies:
    db: "workspace:^"
    mariadb: "npm:3.4.5"

"db@workspace:^, db@workspace:packages/db":
  version: 0.0.0-use.local
  resolution: "db@workspace:packages/db"
  dependencies:
    mysql2: "npm:3.15.3"

"vitest@npm:4.0.0":
  version: 4.0.0
  resolution: "vitest@npm:4.0.0"

"mariadb@npm:3.4.5":
  version: 3.4.5
  resolution: "mariadb@npm:3.4.5"

"mysql2@npm:3.15.3":
  version: 3.15.3
  resolution: "mysql2@npm:3.15.3"
`;

  it("yarn berry: workspace dependencies are production, the root's dev ones are not", () => {
    const list = parseLockfile("yarn.lock", berryWorkspace, root).components;
    expect(find(list, "vitest", "4.0.0")).toMatchObject({ dev: true });
    expect(find(list, "mariadb", "3.4.5")).toMatchObject({ dev: false });
    expect(find(list, "mysql2", "3.15.3")).toMatchObject({ dev: false });
  });

  it("npm: devOptional packages are installed in production", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { next: "16.0.0" } },
        "node_modules/next": { version: "16.0.0", optionalDependencies: { sharp: "0.30.7" } },
        "node_modules/sharp": { version: "0.30.7", devOptional: true, optional: true },
      },
    });
    const list = parseLockfile("package-lock.json", lock, {}).components;
    expect(find(list, "sharp", "0.30.7")).toMatchObject({ dev: false, via: ["next"] });
  });
});
