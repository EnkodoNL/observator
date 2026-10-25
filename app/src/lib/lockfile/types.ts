// SPDX-License-Identifier: FSL-1.1-ALv2
import type { LockfileType } from "@/lib/pb/types";

export interface Component {
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  /** Up to three direct dependencies through which this package is pulled in. */
  via: string[];
}

export interface ParseResult {
  type: LockfileType;
  components: Component[];
}

export interface PackageJson {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export class LockfileError extends Error {}

/** Splits "name@range" where name may be scoped ("@scope/name@range"). */
export function splitSpec(spec: string): [name: string, range: string] {
  const at = spec.indexOf("@", 1);
  if (at === -1) return [spec, ""];
  return [spec.slice(0, at), spec.slice(at + 1)];
}
