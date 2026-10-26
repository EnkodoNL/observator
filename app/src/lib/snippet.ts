// SPDX-License-Identifier: FSL-1.1-ALv2

export type SnippetVariant = "alpine" | "node" | "curl";

export const SNIPPET_VARIANTS: { id: SnippetVariant; label: string; hint: string }[] = [
  { id: "alpine", label: "Alpine", hint: "node:*-alpine, uses BusyBox wget" },
  { id: "node", label: "Debian slim", hint: "node:*-slim has no wget or curl; posts with Node's fetch" },
  { id: "curl", label: "curl", hint: "Images that ship curl, such as node:22 (full Debian)" },
];

const LOCKFILES = "$(ls package-lock.json yarn.lock pnpm-lock.yaml 2>/dev/null)";

const POST: Record<SnippetVariant, string[]> = {
  alpine: [
    // BusyBox wget sends --post-file as a C string and stops at the first NUL byte, so the
    // gzip is base64-encoded first; the server accepts both forms.
    `      && base64 /tmp/obs.tgz > /tmp/obs.b64 \\`,
    `      && wget -q -O /tmp/obs.txt -T 30 \\`,
    `           --header "Authorization: Bearer $key" \\`,
    `           --header "X-Node-Version: $(node -v)" \\`,
    `           --header "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \\`,
    `           --header "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \\`,
    `           --header "X-Fail-On: $OBSERVATOR_FAIL_ON" \\`,
    `           --header "X-Project: $OBSERVATOR_PROJECT" \\`,
    `           --header "X-Labels: $OBSERVATOR_LABELS" \\`,
    `           --post-file /tmp/obs.b64 "$OBSERVATOR_URL/api/ingest" \\`,
  ],
  curl: [
    `      && curl -fsS -m 30 -o /tmp/obs.txt \\`,
    `           -H "Authorization: Bearer $key" \\`,
    `           -H "X-Node-Version: $(node -v)" \\`,
    `           -H "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \\`,
    `           -H "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \\`,
    `           -H "X-Fail-On: $OBSERVATOR_FAIL_ON" \\`,
    `           -H "X-Project: $OBSERVATOR_PROJECT" \\`,
    `           -H "X-Labels: $OBSERVATOR_LABELS" \\`,
    `           --data-binary @/tmp/obs.tgz "$OBSERVATOR_URL/api/ingest" \\`,
  ],
  node: [
    `      && node -e ' \\`,
    `           const fs = require("fs"), env = process.env; \\`,
    `           const os = ((fs.existsSync("/etc/os-release") ? fs.readFileSync("/etc/os-release", "utf8") : "").match(/^ID="?([a-z0-9._-]+)/m) || [])[1] || ""; \\`,
    `           fetch(env.OBSERVATOR_URL + "/api/ingest", { method: "POST", body: fs.readFileSync("/tmp/obs.tgz"), \\`,
    `             signal: AbortSignal.timeout(30000), headers: { \\`,
    `               "Authorization": "Bearer " + env.OBSERVATOR_KEY, "X-Node-Version": process.version, \\`,
    `               "X-Platform": process.platform + "/" + process.arch, "X-Os": os, "X-Fail-On": env.OBSERVATOR_FAIL_ON || "", \\`,
    `               "X-Project": env.OBSERVATOR_PROJECT || "", "X-Labels": env.OBSERVATOR_LABELS || "" } }) \\`,
    `           .then(async (r) => { const t = await r.text(); if (!r.ok) { console.log(t.trim()); process.exit(1); } \\`,
    `             fs.writeFileSync("/tmp/obs.txt", t); }).catch((e) => { console.log(String(e)); process.exit(1); })' \\`,
  ],
};

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
 * as a build argument (unless the `key` option writes it into the Dockerfile), and it is read
 * via node so BuildKit's log output does not show it either.
 */
export interface SnippetOptions {
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
}

/** A default inside ARG NAME="...": no quotes, escapes or variables that Docker would interpret. */
const argValue = (v: string | undefined) => (v ?? "").replace(/["\\$`\r\n]/g, "").trim();

export function dockerSnippet(
  variant: SnippetVariant,
  url: string,
  { stage = "app", lockfileFrom, keyless = false, key, project, labels }: SnippetOptions = {},
): string {
  return [
    "# --- Observator: reports Node version + lockfile; does not end up in the final image ---",
    `FROM ${stage} AS observator`,
    ...(lockfileFrom ? copyLockfileLines(lockfileFrom) : []),
    `ARG OBSERVATOR_URL=${url}`,
    `ARG OBSERVATOR_KEY="${argValue(key)}"`,
    `ARG OBSERVATOR_FAIL_ON=""`,
    `ARG OBSERVATOR_PROJECT="${argValue(project)}"`,
    `ARG OBSERVATOR_LABELS="${argValue(labels)}"`,
    // Read through node instead of $OBSERVATOR_KEY: BuildKit prints RUN commands with build
    // args substituted, which would put the key in the build log. (printenv is not in BusyBox.)
    `RUN key="$(node -p 'process.env.OBSERVATOR_KEY || ""')"; ${keyless ? "" : '[ -z "$key" ] || '}{ \\`,
    `      tar czf /tmp/obs.tgz package.json ${LOCKFILES} \\`,
    ...POST[variant],
    `      && cat /tmp/obs.txt \\`,
    `      || echo "Observator: report failed, continuing"; \\`,
    `    }; \\`,
    `    ! grep -q '^OBSERVATOR_GATE=fail' /tmp/obs.txt 2>/dev/null && touch /tmp/.observator`,
    "",
    `FROM ${stage}`,
    "COPY --from=observator /tmp/.observator /tmp/.observator",
  ].join("\n");
}

export function buildCommand(key: string, project?: string): string {
  const name = project ? ` --build-arg OBSERVATOR_PROJECT=${project}` : "";
  return `docker build --build-arg OBSERVATOR_KEY=${key}${name} .`;
}
