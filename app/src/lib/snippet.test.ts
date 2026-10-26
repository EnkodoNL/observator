// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyLockfileLines, dockerSnippet, SNIPPET_VARIANTS, sourceDir, stageName } from "./snippet";
import { EXAMPLE_DOCKERFILES, exampleDockerfile } from "./snippet-examples";

describe("dockerSnippet", () => {
  it.each(SNIPPET_VARIANTS.map((v) => v.id))("%s never names the key variable after RUN", (variant) => {
    const run = dockerSnippet(variant, "https://obs.example.com").split("RUN ")[1];
    // BuildKit substitutes build args when it prints RUN commands; $OBSERVATOR_KEY would leak.
    expect(run).not.toMatch(/\$\{?OBSERVATOR_KEY/);
    expect(run).toContain("process.env.OBSERVATOR_KEY");
  });

  it("follows the name of the final stage", () => {
    const snippet = dockerSnippet("alpine", "https://obs.example.com", { stage: "runner" });
    expect(snippet).toContain("FROM runner AS observator");
    expect(snippet.trimEnd().split("\n").at(-2)).toBe("FROM runner");
  });

  it.each([
    ["Runner", "runner"],
    [" build-2 ", "build-2"],
    ["", "app"],
    ["2fast", "app"],
    ["has space", "app"],
    ["observator", "app"],
  ])("stage name %j becomes %j", (input, expected) => {
    expect(stageName(input)).toBe(expected);
  });

  it("copies package.json and the lockfile from another stage when asked", () => {
    const lines = dockerSnippet("alpine", "https://obs.example.com", {
      stage: "runner",
      lockfileFrom: { stage: "deps", dir: "/app" },
    }).split("\n");
    expect(lines.slice(1, 4)).toEqual([
      "FROM runner AS observator",
      "WORKDIR /tmp/observator-report",
      "COPY --from=deps /app/package.json /app/package-lock.json* /app/pnpm-lock.yaml* /app/yarn.lock* ./",
    ]);
  });

  it.each([
    ["/app", "/app"],
    ["/srv/app/", "/srv/app"],
    ["/", "/"],
    ["app", "/app"],
    ["/app/../etc", "/app"],
    ["/app; rm -rf", "/app"],
  ])("source folder %j becomes %j", (input, expected) => {
    expect(sourceDir(input)).toBe(expected);
  });

  it("copies from the root without a double slash", () => {
    expect(copyLockfileLines({ stage: "deps", dir: "/" })[1]).toContain(
      " /package.json /package-lock.json* ",
    );
  });

  it.each(SNIPPET_VARIANTS.map((v) => v.id))("%s without a key check reports either way", (variant) => {
    const guarded = dockerSnippet(variant, "https://obs.example.com");
    const keyless = dockerSnippet(variant, "https://obs.example.com", { keyless: true });
    expect(guarded).toContain(`[ -z "$key" ] || { \\`);
    expect(keyless).not.toContain("[ -z");
    // Nothing else differs: same key handling when one is set.
    expect(keyless).toBe(guarded.replace('[ -z "$key" ] || ', ""));
  });

  it.each(SNIPPET_VARIANTS.map((v) => v.id))("%s sends the labels", (variant) => {
    const snippet = dockerSnippet(variant, "https://obs.example.com");
    expect(snippet).toContain('ARG OBSERVATOR_LABELS=""');
    expect(snippet).toMatch(/X-Labels(: \$OBSERVATOR_LABELS|": env\.OBSERVATOR_LABELS)/);
  });

  it("writes key, project and labels in as defaults when asked", () => {
    const snippet = dockerSnippet("alpine", "https://obs.example.com", {
      key: "obss_abc-DEF_123",
      project: 'heat"wave $web',
      labels: "app:heatwave,role:web",
    });
    expect(snippet).toContain('ARG OBSERVATOR_KEY="obss_abc-DEF_123"');
    // Quotes and variables would be interpreted by Docker, so they are left out.
    expect(snippet).toContain('ARG OBSERVATOR_PROJECT="heatwave web"');
    expect(snippet).toContain('ARG OBSERVATOR_LABELS="app:heatwave,role:web"');
    // Still read through node, so BuildKit does not print it with the RUN line.
    expect(snippet.split("RUN ")[1]).not.toContain("obss_abc");
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

  it("shows the current lines for copying the lockfile from another stage", () => {
    expect(readme).toContain(copyLockfileLines({ stage: "deps", dir: "/app" }).join("\n"));
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
