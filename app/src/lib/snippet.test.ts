// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyLockfileLines,
  DEFAULT_REPORTER_IMAGE,
  dockerSnippet,
  reporterImage,
  type SnippetForm,
  sourceDir,
  stageName,
} from "./snippet";
import { EXAMPLE_DOCKERFILES } from "./snippet-examples";

const URL = "https://obs.example.com";

/** The RUN command as Docker hands it to sh: continuation lines joined, backslashes gone. */
function runCommand(snippet: string): string {
  const all = snippet.split("\n");
  const run: string[] = [];
  for (const line of all.slice(all.findIndex((l) => l.startsWith("RUN ")))) {
    run.push(line);
    if (!line.endsWith("\\")) break;
  }
  return run.join("\n").slice("RUN ".length).replace(/\\\n/g, "");
}

const inline = (run: string, command: string) => run.match(new RegExp(`${command} '([^']*)'`))?.[1] ?? "";

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe("dockerSnippet, plain sh", () => {
  const run = runCommand(dockerSnippet(URL, { form: "shell" }));

  it("never names the key variable after RUN", () => {
    // BuildKit substitutes build args when it prints RUN commands; $OBSERVATOR_KEY would leak.
    expect(run).not.toMatch(/\$\{?OBSERVATOR_KEY/);
    expect(run).toContain(`key="$(env | sed -n 's/^OBSERVATOR_KEY=//p')"`);
  });

  it("is valid sh once Docker has joined the lines", () => {
    expect(() => execFileSync("sh", ["-n", "-c", run])).not.toThrow();
  });

  it("starts the inline code right after the quote", () => {
    // Joined into one line, Python refuses code that starts with whitespace.
    expect(run).toContain(`node -e 'const fs`);
    expect(run).toContain(`python3 -c 'import os`);
  });

  it("has valid Node code", () => {
    expect(() => new Function(inline(run, "node -e"))).not.toThrow();
  });

  it.skipIf(!hasPython)("has valid Python code", () => {
    const check = "import ast, sys; ast.parse(sys.stdin.read())";
    expect(() => execFileSync("python3", ["-c", check], { input: inline(run, "python3 -c") })).not.toThrow();
  });

  it.each(["node", "bun", "deno", "python", "php", "ruby"])("detects %s", (name) => {
    expect(run).toMatch(new RegExp(`&& rt="\\$rt,${name}/\\$\\{v#v\\}"`));
  });

  it.each(["Authorization", "X-Runtime", "X-Platform", "X-Os", "X-Fail-On", "X-Project", "X-Labels"])(
    "sends %s with every client",
    (header) => {
      // curl, wget, node and python3.
      expect(run.split(header).length - 1).toBe(4);
    },
  );

  it("sends an empty archive when there is no package.json", () => {
    expect(run).toContain("else : > /tmp/obs.tgz; fi;");
  });

  it("without a key check reports either way", () => {
    const guarded = dockerSnippet(URL, { form: "shell" });
    const keyless = dockerSnippet(URL, { form: "shell", keyless: true });
    expect(guarded).toContain(`[ -z "$key" ] || { \\`);
    expect(keyless).not.toContain("[ -z");
    // Nothing else differs: same key handling when one is set.
    expect(keyless).toBe(guarded.replace('[ -z "$key" ] || ', ""));
  });
});

describe("dockerSnippet, reporter image", () => {
  const snippet = dockerSnippet(URL);

  it("is the default, in exec form", () => {
    expect(snippet).toContain(`FROM ${DEFAULT_REPORTER_IMAGE} AS observator-reporter`);
    expect(snippet).toContain("COPY --from=observator-reporter /reporter /tmp/observator");
    expect(runCommand(snippet)).toBe('["/tmp/observator"]');
    expect(snippet.split("\n")).toHaveLength(13);
  });

  it("passes --keyless instead of a key check", () => {
    expect(runCommand(dockerSnippet(URL, { keyless: true }))).toBe('["/tmp/observator", "--keyless"]');
  });

  it("takes another image, but nothing that could break the Dockerfile", () => {
    expect(dockerSnippet(URL, { image: "registry.enkodo.dev/observator-reporter:1.2" })).toContain(
      "FROM registry.enkodo.dev/observator-reporter:1.2 AS observator-reporter",
    );
    expect(reporterImage("evil\nRUN rm -rf /")).toBe(DEFAULT_REPORTER_IMAGE);
    expect(reporterImage(undefined)).toBe(DEFAULT_REPORTER_IMAGE);
  });

  it("copies the reporter after the lockfile, into an absolute path", () => {
    const lines = dockerSnippet(URL, { lockfileFrom: { stage: "deps", dir: "/app" } }).split("\n");
    expect(lines.slice(2, 6)).toEqual([
      "FROM app AS observator",
      "WORKDIR /tmp/observator-report",
      "COPY --from=deps /app/package.json /app/package-lock.json* /app/pnpm-lock.yaml* /app/yarn.lock* ./",
      "COPY --from=observator-reporter /reporter /tmp/observator",
    ]);
  });
});

describe.each(["image", "shell"] as SnippetForm[])("dockerSnippet, %s form", (form) => {
  it("never names the key variable after RUN", () => {
    // BuildKit substitutes build args when it prints RUN commands; $OBSERVATOR_KEY would leak.
    expect(runCommand(dockerSnippet(URL, { form }))).not.toMatch(/\$\{?OBSERVATOR_KEY/);
  });

  it("follows the name of the final stage", () => {
    const snippet = dockerSnippet(URL, { form, stage: "runner" });
    expect(snippet).toContain("FROM runner AS observator");
    expect(snippet.trimEnd().split("\n").at(-2)).toBe("FROM runner");
  });

  it("writes key, project and labels in as defaults when asked", () => {
    const snippet = dockerSnippet(URL, {
      form,
      key: "obss_abc-DEF_123",
      project: 'heat"wave $web',
      labels: "app:heatwave,role:web",
    });
    expect(snippet).toContain('ARG OBSERVATOR_KEY="obss_abc-DEF_123"');
    // Quotes and variables would be interpreted by Docker, so they are left out.
    expect(snippet).toContain('ARG OBSERVATOR_PROJECT="heatwave web"');
    expect(snippet).toContain('ARG OBSERVATOR_LABELS="app:heatwave,role:web"');
    // Still read from the environment, so BuildKit does not print it with the RUN line.
    expect(runCommand(snippet)).not.toContain("obss_abc");
  });

  it("fills in the URL", () => {
    expect(dockerSnippet(URL, { form })).toContain(`ARG OBSERVATOR_URL=${URL}`);
  });
});

describe("snippet helpers", () => {
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
    const lines = dockerSnippet(URL, {
      form: "shell",
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
});

describe("examples/", () => {
  it.each(EXAMPLE_DOCKERFILES)("$path matches the generated snippet", ({ path, content }) => {
    const actual = readFileSync(join(__dirname, "..", "..", "..", "examples", path), "utf8");
    expect(actual, "run `node --no-warnings app/scripts/write-examples.ts`").toBe(content());
  });
});

describe("README", () => {
  const readme = readFileSync(join(__dirname, "..", "..", "..", "README.md"), "utf8");

  it.each(["image", "shell"] as SnippetForm[])("shows the current %s snippet", (form) => {
    expect(readme).toContain(dockerSnippet("https://observator.example.com", { form }));
  });

  it("shows the current lines for copying the lockfile from another stage", () => {
    expect(readme).toContain(copyLockfileLines({ stage: "deps", dir: "/app" }).join("\n"));
  });
});
