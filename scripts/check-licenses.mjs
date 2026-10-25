#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Fails when a dependency's license does not allow shipping it in Observator, which is
// FSL-1.1-ALv2 (and later Apache-2.0): permissive licenses only, plus LGPL for a library that is
// linked dynamically and can be replaced.
// Reads app/package-lock.json, which records the license of every installed package.
// Usage: node scripts/check-licenses.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lockPath = fileURLToPath(new URL("../app/package-lock.json", import.meta.url));
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

// Licenses that allow use and redistribution in a commercially licensed program.
const RUNTIME_OK = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "OFL-1.1", // fonts (Geist)
  "CC-BY-4.0", // data only (caniuse-lite, used by the build tooling)
  "LGPL-3.0-or-later", // libvips, an optional prebuilt dependency of sharp
  "Python-2.0",
]);
// Build and test tooling that is not shipped in the image.
const DEV_OK = new Set([...RUNTIME_OK, "MPL-2.0"]);

const ALIASES = { "SIL OPEN FONT LICENSE": "OFL-1.1", "OFL": "OFL-1.1" };

/** Evaluates simple SPDX expressions: "A OR B", "A AND B", parentheses. */
function allowed(expr, ok) {
  const normalized = ALIASES[expr.trim()] ?? expr.trim();
  const tokens = normalized.replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean);
  let pos = 0;
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[pos] === "OR") {
      pos++;
      value = parseAnd() || value;
    }
    return value;
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (tokens[pos] === "AND") {
      pos++;
      value = parseAtom() && value;
    }
    return value;
  };
  const parseAtom = () => {
    const t = tokens[pos++];
    if (t === "(") {
      const v = parseOr();
      pos++;
      return v;
    }
    return ok.has(ALIASES[t] ?? t);
  };
  return parseOr();
}

const problems = [];
let checked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.link) continue;
  checked++;
  const dev = entry.dev === true || entry.devOptional === true;
  const license = typeof entry.license === "string" ? entry.license : entry.license?.type;
  const name = path.slice(path.lastIndexOf("node_modules/") + 13);
  if (!license) problems.push(`${name}@${entry.version}: no license field`);
  else if (!allowed(license, dev ? DEV_OK : RUNTIME_OK)) problems.push(`${name}@${entry.version}: ${license}${dev ? " (dev)" : ""}`);
}

if (problems.length) {
  console.error(`License check failed for ${problems.length} of ${checked} packages:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`License check passed: ${checked} packages are compatible with FSL-1.1-ALv2.`);
