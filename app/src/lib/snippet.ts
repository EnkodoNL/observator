// SPDX-License-Identifier: FSL-1.1-ALv2

const MANIFESTS = "package.json package-lock.json yarn.lock pnpm-lock.yaml";

/**
 * Runtimes the snippet looks for, each with a command that prints only its version. Absent
 * ones fail silently; what is found goes into X-Runtime as name/version.
 */
const RUNTIMES: [name: string, command: string][] = [
  ["node", "node -v"],
  ["bun", "bun --version"],
  ["deno", "deno eval 'console.log(Deno.version.deno)'"],
  ["python", "python3 -c 'import platform;print(platform.python_version())'"],
  ["php", "php -r 'echo PHP_VERSION;'"],
  ["ruby", "ruby -e 'print RUBY_VERSION'"],
];

/** The headers every client sends; the values come from the shell variables set before. */
const HEADERS: [header: string, value: string][] = [
  ["Authorization", "Bearer $key"],
  ["X-Runtime", "$OBS_RUNTIME"],
  ["X-Platform", "$OBS_PLATFORM"],
  ["X-Os", "$OBS_OS"],
  ["X-Fail-On", "$OBSERVATOR_FAIL_ON"],
  ["X-Project", "$OBSERVATOR_PROJECT"],
  ["X-Labels", "$OBSERVATOR_LABELS"],
];

// node and python3 read the same values from the environment (OBS_KEY instead of $key).
const envName = (value: string) => value.replace(/^Bearer \$key$/, "OBS_KEY").replace(/^\$/, "");

const NODE_POST = [
  'const fs = require("fs"), e = process.env;',
  'fetch(e.OBSERVATOR_URL + "/api/ingest", { method: "POST", body: fs.readFileSync("/tmp/obs.tgz"),',
  "signal: AbortSignal.timeout(30000), headers: {",
  ...HEADERS.map(([h, v]) =>
    h === "Authorization" ? `  "${h}": "Bearer " + e.OBS_KEY,` : `  "${h}": e.${envName(v)} || "",`,
  ),
  "} }).then(async (r) => { const t = await r.text(); if (!r.ok) { console.log(t.trim()); process.exit(1); }",
  'fs.writeFileSync("/tmp/obs.txt", t); }).catch((x) => { console.log(String(x)); process.exit(1); })',
];

const PYTHON_POST = [
  "import os, urllib.request as u; e = os.environ;",
  'h = {k: e.get(v, "") for k, v in [',
  ...HEADERS.filter(([h]) => h !== "Authorization").map(([h, v]) => `  ("${h}", "${envName(v)}"),`),
  "]};",
  'h["Authorization"] = "Bearer " + e["OBS_KEY"];',
  'r = u.urlopen(u.Request(e["OBSERVATOR_URL"] + "/api/ingest", data=open("/tmp/obs.tgz", "rb").read(), headers=h), timeout=30);',
  'open("/tmp/obs.txt", "wb").write(r.read())',
];

/** Continuation lines of the RUN, indented under it. */
const lines = (indent: number, parts: string[]) => parts.map((p) => `${" ".repeat(indent)}${p} \\`);

/**
 * The name of the user's final stage, as typed. BuildKit wants stage names lowercase; anything
 * that is not a valid name (or would clash with the snippet's own stage) falls back to "app".
 */
export function stageName(input: string, fallback = "app"): string {
  const name = input.trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{0,62}$/.test(name) && name !== "observator" ? name : fallback;
}

/**
 * Where package.json and the lockfile are when the last stage does not have them, such as a
 * Next.js standalone image: an earlier stage and the folder they were copied to there.
 */
export interface LockfileSource {
  stage: string;
  dir: string;
}

/** An absolute folder as typed, without a trailing slash; anything odd falls back to /app. */
export function sourceDir(input: string): string {
  const dir = input.trim().replace(/\/+$/, "") || "/";
  return /^\/[A-Za-z0-9._/-]*$/.test(dir) && !dir.split("/").includes("..") ? dir : "/app";
}

/**
 * Copies package.json and whichever lockfile exists into a folder of its own. The * makes each
 * lockfile optional: COPY skips a pattern without matches as long as another source matches.
 */
export function copyLockfileLines({ stage, dir }: LockfileSource): string[] {
  const d = dir === "/" ? "" : dir;
  return [
    "WORKDIR /tmp/observator-report",
    `COPY --from=${stage} ${d}/package.json ${d}/package-lock.json* ${d}/pnpm-lock.yaml* ${d}/yarn.lock* ./`,
  ];
}

/**
 * The Dockerfile addition. It reports from a separate stage so the key never lands in the
 * final image or its history; the COPY forces BuildKit to run that stage. The key is passed
 * as a build argument (unless the `key` option writes it into the Dockerfile).
 */
/**
 * "image" copies the reporter binary from its image: a few lines, and it also works without a
 * shell (distroless). "shell" is the same logic in plain sh, for builds that cannot pull from
 * a registry.
 */
export type SnippetForm = "image" | "shell";

export const DEFAULT_REPORTER_IMAGE = "ghcr.io/enkodonl/observator-reporter:1";

/** An image reference as typed in REPORTER_IMAGE; anything odd falls back to the default. */
export const reporterImage = (input: string | undefined) =>
  input && /^[a-z0-9][a-z0-9._/:@-]{0,254}$/i.test(input.trim()) ? input.trim() : DEFAULT_REPORTER_IMAGE;

export interface SnippetOptions {
  /** "image" (default) or "shell". */
  form?: SnippetForm;
  /** The reporter image for the "image" form, such as a mirror. */
  image?: string;
  /** The name of the user's last stage. */
  stage?: string;
  /** Where package.json and the lockfile are, when the last stage lacks them. */
  lockfileFrom?: LockfileSource;
  /**
   * Report also without OBSERVATOR_KEY, for servers on a shared key's IP allowlist. The
   * default snippet sends nothing without a key, so a build on a laptop stays local.
   */
  keyless?: boolean;
  /** Written into the Dockerfile as the default for OBSERVATOR_KEY (a build variable still wins). */
  key?: string;
  /** Default for OBSERVATOR_PROJECT: the project a shared key reports to. */
  project?: string;
  /** Default for OBSERVATOR_LABELS, such as "app:heatwave,role:web". */
  labels?: string;
  /** Default for OBSERVATOR_FAIL_ON: the severity from which the build fails. */
  failOn?: string;
}

/** A default inside ARG NAME="...": no quotes, escapes or variables that Docker would interpret. */
const argValue = (v: string | undefined) => (v ?? "").replace(/["\\$`\r\n]/g, "").trim();

/** The reporter in exec form: no shell, and BuildKit prints only this line. */
const imageRun = (keyless: boolean) => `RUN ["/tmp/observator"${keyless ? ', "--keyless"' : ""}]`;

function shellRun(keyless: boolean): string[] {
  const curlHeaders = HEADERS.map(([h, v]) => `-H "${h}: ${v}"`);
  const wgetHeaders = HEADERS.map(([h, v]) => `--header "${h}: ${v}"`);
  return [
    // The key is read from the environment, never as $OBSERVATOR_KEY: BuildKit prints RUN lines
    // with build args filled in, which would put it in the build log. Plain sh throughout, so
    // any image with a shell works, whatever runtime it has.
    `RUN key="$(env | sed -n 's/^OBSERVATOR_KEY=//p')"; ${keyless ? "" : '[ -z "$key" ] || '}{ \\`,
    `      rt=""; \\`,
    ...RUNTIMES.map(
      ([name, command]) => `      v="$(${command} 2>/dev/null)" && rt="$rt,${name}/\${v#v}"; \\`,
    ),
    `      export OBS_KEY="$key" OBS_RUNTIME="\${rt#,}" OBS_PLATFORM="$(uname -s)/$(uname -m)" \\`,
    `        OBS_OS="$(. /etc/os-release 2>/dev/null; echo "$ID")"; \\`,
    `      files="$(ls ${MANIFESTS} 2>/dev/null)"; \\`,
    `      if [ -n "$files" ]; then tar czf /tmp/obs.tgz $files; else : > /tmp/obs.tgz; fi; \\`,
    `      if command -v curl >/dev/null; then \\`,
    ...lines(8, ["curl -fsS -m 30 -o /tmp/obs.txt"]),
    ...lines(10, [...curlHeaders, '--data-binary @/tmp/obs.tgz "$OBSERVATOR_URL/api/ingest";']),
    // BusyBox wget sends --post-file as a C string and stops at the first NUL byte, so the
    // archive goes base64-encoded; the server accepts both forms.
    `      elif command -v wget >/dev/null; then \\`,
    ...lines(8, ["base64 /tmp/obs.tgz > /tmp/obs.b64 && wget -q -O /tmp/obs.txt -T 30"]),
    ...lines(10, [...wgetHeaders, '--post-file /tmp/obs.b64 "$OBSERVATOR_URL/api/ingest";']),
    `      elif command -v node >/dev/null; then \\`,
    // The code starts right after the quote: Docker joins these lines into one, and Python
    // refuses code that starts with whitespace.
    `        node -e '${NODE_POST[0]} \\`,
    ...lines(10, NODE_POST.slice(1)),
    `        '; \\`,
    `      elif command -v python3 >/dev/null; then \\`,
    `        python3 -c '${PYTHON_POST[0]} \\`,
    ...lines(10, PYTHON_POST.slice(1)),
    `        ' 2>/dev/null; \\`,
    `      else echo "Observator: no curl, wget, node or python3 in this image"; false; fi \\`,
    `      && cat /tmp/obs.txt \\`,
    `      || echo "Observator: report failed, continuing"; \\`,
    `    }; \\`,
    `    ! grep -q '^OBSERVATOR_GATE=fail' /tmp/obs.txt 2>/dev/null && touch /tmp/.observator`,
  ];
}

export function dockerSnippet(
  url: string,
  {
    form = "image",
    image,
    stage = "app",
    lockfileFrom,
    keyless = false,
    key,
    project,
    labels,
    failOn,
  }: SnippetOptions = {},
): string {
  const reporter = form === "image";
  return [
    "# --- Observator: reports runtime versions + lockfile; does not end up in the final image ---",
    // COPY --from does not expand variables, so the image gets a stage name of its own. A build
    // can swap it with --build-context <image>=docker-image://<mirror>.
    ...(reporter ? [`FROM ${reporterImage(image)} AS observator-reporter`] : []),
    `FROM ${stage} AS observator`,
    ...(lockfileFrom ? copyLockfileLines(lockfileFrom) : []),
    ...(reporter ? ["COPY --from=observator-reporter /reporter /tmp/observator"] : []),
    `ARG OBSERVATOR_URL=${url}`,
    `ARG OBSERVATOR_KEY="${argValue(key)}"`,
    `ARG OBSERVATOR_FAIL_ON="${argValue(failOn)}"`,
    `ARG OBSERVATOR_PROJECT="${argValue(project)}"`,
    `ARG OBSERVATOR_LABELS="${argValue(labels)}"`,
    ...(reporter ? [imageRun(keyless)] : shellRun(keyless)),
    "",
    `FROM ${stage}`,
    "COPY --from=observator /tmp/.observator /tmp/.observator",
  ].join("\n");
}

export function buildCommand(key: string, project?: string): string {
  const name = project ? ` --build-arg OBSERVATOR_PROJECT=${project}` : "";
  return `docker build --build-arg OBSERVATOR_KEY=${key}${name} .`;
}
