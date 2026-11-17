// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import type { VulnIssueData } from "@/lib/issues/types";
import { packageAdvice } from "./advice";

const base: VulnIssueData = {
  package: "qs",
  version: "6.7.0",
  osvId: "GHSA-hrpp-h998-j3pp",
  aliases: [],
  summary: "",
  fixedIn: "6.7.3",
  url: "",
  direct: false,
  dev: false,
  via: ["express"],
};

describe("packageAdvice", () => {
  it("raises a Go module with go get, whatever the project's lockfile", () => {
    const go = {
      ...base,
      ecosystem: "Go",
      package: "golang.org/x/net",
      version: "v0.20.0",
      fixedIn: "v0.23.0",
      via: [],
    };
    for (const lockfile of ["go", "npm"] as const)
      expect(packageAdvice(go, lockfile).snippets[0].code).toBe(
        "go get golang.org/x/net@v0.23.0 && go mod tidy",
      );
  });

  it("updates a release binary itself instead of raising a module", () => {
    const program = {
      ...base,
      ecosystem: "Go",
      version: "v0.39.0",
      fixedIn: "v0.39.7",
      direct: true,
      via: [],
    };
    const pocketbase = packageAdvice({ ...program, package: "ganigeorgiev.com/pocketbase/pocketbase" }, "go");
    expect(pocketbase.text).toMatch(/^Update PocketBase to 0\.39\.7 or later/);
    expect(pocketbase.snippets).toEqual([{ label: "Dockerfile", code: "ARG PB_VERSION=0.39.7" }]);
    const other = packageAdvice({ ...program, package: "github.com/acme/tool" }, "go");
    expect(other.text).toMatch(
      /^Update github\.com\/acme\/tool to v0\.39\.7 or later: this is the program itself/,
    );
    expect(other.snippets).toEqual([]);
  });

  it("asks for a newer image for an app in Coolify or a package Coolify's scan found", () => {
    const app = packageAdvice(
      {
        ...base,
        ecosystem: "GitHub",
        package: "example/app",
        version: "2.4.0",
        fixedIn: "2.5.9",
        direct: true,
        via: [],
      },
      "none",
    );
    expect(app.text).toMatch(
      /^Update example\/app to 2\.5\.9 or later: set its image to that release in Coolify/,
    );
    const scanned = packageAdvice(
      {
        ...base,
        ecosystem: "coolify:deb",
        package: "libexample",
        version: "1.0.1",
        fixedIn: "1.0.2",
        via: [],
      },
      "none",
    );
    expect(scanned.text).toMatch(/^libexample is fixed in 1\.0\.2\. Take an image that carries it/);
    expect(scanned.snippets).toEqual([]);
  });

  it("upgrades direct dependencies with the right package manager", () => {
    const d = { ...base, package: "lodash", version: "4.17.20", fixedIn: "4.17.21", direct: true, via: [] };
    expect(packageAdvice(d, "npm").snippets[0].code).toBe("npm install lodash@4.17.21");
    expect(packageAdvice({ ...d, dev: true }, "pnpm").snippets[0].code).toBe("pnpm add -D lodash@4.17.21");
    expect(packageAdvice(d, "yarn-berry").snippets[0].code).toBe("yarn add lodash@4.17.21");
  });

  it("suggests the parent upgrade or an override for transitive ones", () => {
    const npm = packageAdvice(base, "npm");
    expect(npm.text).toContain("pulled in by express");
    expect(npm.snippets[0].code).toBe('"overrides": {\n  "qs": "^6.7.3"\n}');
    expect(packageAdvice(base, "yarn-v1").snippets[0].code).toContain('"resolutions"');
    expect(packageAdvice(base, "pnpm").snippets[0].code).toBe('overrides:\n  qs: "^6.7.3"');
  });

  it("warns about major upgrades and missing fixes", () => {
    expect(packageAdvice({ ...base, fixedIn: "7.0.0" }, "npm").text).toContain("new major version (7.x)");
    expect(packageAdvice({ ...base, fixedIn: "" }, "npm").snippets).toEqual([]);
  });
});

describe("outdatedLevel", () => {
  it("labels how far behind a direct dependency is", async () => {
    const { outdatedLevel } = await import("./npm-latest");
    expect(outdatedLevel("4.17.1", "5.1.0")).toBe("major");
    expect(outdatedLevel("4.17.1", "4.21.2")).toBe("minor");
    expect(outdatedLevel("4.17.20", "4.17.21")).toBe("patch");
    expect(outdatedLevel("4.18.1", "4.18.1")).toBeNull();
    expect(outdatedLevel("5.0.0-beta.1", "4.21.2")).toBeNull();
    expect(outdatedLevel("1.0.0", undefined)).toBeNull();
  });
});
