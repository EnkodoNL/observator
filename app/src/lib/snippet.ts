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
    `      && wget -q -O /tmp/obs.txt -T 30 \\`,
    `           --header "Authorization: Bearer $OBSERVATOR_KEY" \\`,
    `           --header "X-Node-Version: $(node -v)" \\`,
    `           --header "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \\`,
    `           --header "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \\`,
    `           --header "X-Fail-On: $OBSERVATOR_FAIL_ON" \\`,
    `           --post-file /tmp/obs.tgz "$OBSERVATOR_URL/api/ingest" \\`,
  ],
  curl: [
    `      && curl -fsS -m 30 -o /tmp/obs.txt \\`,
    `           -H "Authorization: Bearer $OBSERVATOR_KEY" \\`,
    `           -H "X-Node-Version: $(node -v)" \\`,
    `           -H "X-Platform: $(node -p 'process.platform+"/"+process.arch')" \\`,
    `           -H "X-Os: $(. /etc/os-release 2>/dev/null; echo "$ID")" \\`,
    `           -H "X-Fail-On: $OBSERVATOR_FAIL_ON" \\`,
    `           --data-binary @/tmp/obs.tgz "$OBSERVATOR_URL/api/ingest" \\`,
  ],
  node: [
    `      && node -e ' \\`,
    `           const fs = require("fs"), env = process.env; \\`,
    `           const os = ((fs.existsSync("/etc/os-release") ? fs.readFileSync("/etc/os-release", "utf8") : "").match(/^ID="?([a-z0-9._-]+)/m) || [])[1] || ""; \\`,
    `           fetch(env.OBSERVATOR_URL + "/api/ingest", { method: "POST", body: fs.readFileSync("/tmp/obs.tgz"), \\`,
    `             signal: AbortSignal.timeout(30000), headers: { \\`,
    `               "Authorization": "Bearer " + env.OBSERVATOR_KEY, "X-Node-Version": process.version, \\`,
    `               "X-Platform": process.platform + "/" + process.arch, "X-Os": os, "X-Fail-On": env.OBSERVATOR_FAIL_ON || "" } }) \\`,
    `           .then(async (r) => { const t = await r.text(); if (!r.ok) { console.log(t.trim()); process.exit(1); } \\`,
    `             fs.writeFileSync("/tmp/obs.txt", t); }).catch((e) => { console.log(String(e)); process.exit(1); })' \\`,
  ],
};

/**
 * The Dockerfile addition. It reports from a separate stage so the key never lands in the
 * final image or its history; the COPY forces BuildKit to run that stage. The key itself
 * is passed as a build argument and never written into the Dockerfile.
 */
export function dockerSnippet(variant: SnippetVariant, url: string): string {
  return [
    "# --- Observator: reports Node version + lockfile; does not end up in the final image ---",
    "FROM app AS observator",
    `ARG OBSERVATOR_URL=${url}`,
    `ARG OBSERVATOR_KEY=""`,
    `ARG OBSERVATOR_FAIL_ON=""`,
    `RUN [ -z "$OBSERVATOR_KEY" ] || { \\`,
    `      tar czf /tmp/obs.tgz package.json ${LOCKFILES} \\`,
    ...POST[variant],
    `      && cat /tmp/obs.txt \\`,
    `      || echo "Observator: report failed, continuing"; \\`,
    `    }; \\`,
    `    ! grep -q '^OBSERVATOR_GATE=fail' /tmp/obs.txt 2>/dev/null && touch /tmp/.observator`,
    "",
    "FROM app",
    "COPY --from=observator /tmp/.observator /tmp/.observator",
  ].join("\n");
}

export function buildCommand(key: string): string {
  return `docker build --build-arg OBSERVATOR_KEY=${key} .`;
}
