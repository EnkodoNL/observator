#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Every tracked source file starts with an SPDX license identifier (within the first lines,
// after a shebang or a "use client" directive). Usage: node scripts/check-spdx.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const root = new URL("..", import.meta.url);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs|sh|css|go|yml)$/;
const SKIP = [/__fixtures__\//, /next-env\.d\.ts$/, /\.d\.ts$/];

// Components copied from shadcn/ui keep their original MIT license; the reporter is Apache-2.0
// so it can go into anyone's build pipeline without a second thought.
const MIT_OK = /^app\/src\/components\/ui\//;
const APACHE = /^reporter\//;

const missing = [];
let checked = 0;
for (const file of files) {
  const isDockerfile = basename(file).startsWith("Dockerfile");
  if (!SOURCE.test(file) && !isDockerfile) continue;
  if (SKIP.some((re) => re.test(file))) continue;
  checked++;
  const head = readFileSync(new URL(file, root), "utf8").split("\n").slice(0, 4).join("\n");
  const match = /SPDX-License-Identifier:\s*([\w.+-]+)/.exec(head);
  const id = match?.[1];
  const expected = APACHE.test(file) ? "Apache-2.0" : "FSL-1.1-ALv2";
  if (id === expected || (id === "MIT" && MIT_OK.test(file))) continue;
  missing.push(`${file}${id ? ` (has ${id})` : ""}`);
}

if (missing.length) {
  console.error(`SPDX check failed for ${missing.length} of ${checked} files:`);
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`SPDX check passed: ${checked} files.`);
