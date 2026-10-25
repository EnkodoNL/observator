// SPDX-License-Identifier: FSL-1.1-ALv2
import semver from "semver";
import { vulnVersions, type VulnIssueData } from "@/lib/issues/types";
import type { LockfileType } from "@/lib/pb/types";

export interface Advice {
  text: string;
  snippets: { label: string; code: string }[];
}

const majorOf = (v: string) => semver.coerce(v)?.major ?? null;

/** What to do about one advisory, in the syntax of the project's package manager. */
export function packageAdvice(d: VulnIssueData, lockfile: LockfileType): Advice {
  if (!d.fixedIn) {
    return {
      text: "No fixed version is published yet. Check whether the affected code path is used at all; if it is not, ignore the advisory with a reason.",
      snippets: [],
    };
  }
  const installed = vulnVersions(d)[0];
  const crossesMajor = majorOf(d.fixedIn) !== null && majorOf(d.fixedIn) !== majorOf(installed);
  const majorNote = crossesMajor
    ? ` The fix is in a new major version (${majorOf(d.fixedIn)}.x), so check for breaking changes.`
    : "";
  const dev = d.dev ? " -D" : "";

  if (d.direct) {
    const cmd: Record<LockfileType, string> = {
      npm: `npm install${dev} ${d.package}@${d.fixedIn}`,
      "yarn-v1": `yarn add${dev} ${d.package}@${d.fixedIn}`,
      "yarn-berry": `yarn add${dev} ${d.package}@${d.fixedIn}`,
      pnpm: `pnpm add${dev} ${d.package}@${d.fixedIn}`,
      none: `npm install${dev} ${d.package}@${d.fixedIn}`,
    };
    return {
      text: `${d.package} is a direct dependency. Upgrade it to ${d.fixedIn} or later.${majorNote}`,
      snippets: [{ label: "Upgrade", code: cmd[lockfile] }],
    };
  }

  const range = `^${d.fixedIn}`;
  const via = d.via.length ? d.via.join(", ") : "another dependency";
  const override: Record<LockfileType, { label: string; code: string }> = {
    npm: { label: "package.json", code: `"overrides": {\n  "${d.package}": "${range}"\n}` },
    none: { label: "package.json", code: `"overrides": {\n  "${d.package}": "${range}"\n}` },
    "yarn-v1": { label: "package.json", code: `"resolutions": {\n  "${d.package}": "${range}"\n}` },
    "yarn-berry": { label: "package.json", code: `"resolutions": {\n  "${d.package}": "${range}"\n}` },
    pnpm: {
      label: 'pnpm-workspace.yaml (pnpm 10+; older: "pnpm.overrides" in package.json)',
      code: `overrides:\n  ${d.package}: "${range}"`,
    },
  };
  return {
    text: `${d.package} is pulled in by ${via}. Upgrading ${d.via.length === 1 ? d.via[0] : "that dependency"} may already bring ${d.fixedIn}; otherwise force the fixed version.${majorNote}`,
    snippets: [override[lockfile]],
  };
}
