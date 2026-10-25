// SPDX-License-Identifier: FSL-1.1-ALv2

/** /packages/lodash, /packages/@types/node: scoped names keep their slash and a readable "@". */
export function packageHref(name: string): string {
  return `/packages/${name
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/^%40/, "@"))
    .join("/")}`;
}

/** The inverse, for the catch-all route segments. */
export function packageNameFromSegments(segments: string[]): string {
  return segments.map((s) => decodeURIComponent(s)).join("/");
}
