// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dockerSnippet, SNIPPET_VARIANTS } from "./snippet";
import { EXAMPLE_DOCKERFILES, exampleDockerfile } from "./snippet-examples";

describe("dockerSnippet", () => {
  it.each(SNIPPET_VARIANTS.map((v) => v.id))("%s never names the key variable after RUN", (variant) => {
    const run = dockerSnippet(variant, "https://obs.example.com").split("RUN ")[1];
    // BuildKit substitutes build args when it prints RUN commands; $OBSERVATOR_KEY would leak.
    expect(run).not.toMatch(/\$\{?OBSERVATOR_KEY/);
    expect(run).toContain("process.env.OBSERVATOR_KEY");
  });

  it("fills in the URL", () => {
    expect(dockerSnippet("alpine", "https://obs.example.com")).toContain(
      "ARG OBSERVATOR_URL=https://obs.example.com",
    );
  });
});

describe("examples/express-app", () => {
  it.each(EXAMPLE_DOCKERFILES)("$file matches the generated snippet", ({ file, variant, image, note }) => {
    const actual = readFileSync(join(__dirname, "..", "..", "..", "examples", "express-app", file), "utf8");
    expect(actual, "run `node --no-warnings app/scripts/write-examples.ts`").toBe(
      exampleDockerfile(variant, image, note),
    );
  });
});

describe("README", () => {
  const readme = readFileSync(join(__dirname, "..", "..", "..", "README.md"), "utf8");

  it("shows the current Alpine snippet", () => {
    expect(readme).toContain(dockerSnippet("alpine", "https://observator.example.com"));
  });

  it.each(["node", "curl"] as const)("shows the current %s upload lines", (variant) => {
    const snippet = dockerSnippet(variant, "https://observator.example.com");
    const upload = snippet.slice(
      snippet.indexOf("      && ", snippet.indexOf("tar czf")),
      snippet.indexOf("      && cat /tmp/obs.txt"),
    );
    expect(readme).toContain(upload);
  });
});
