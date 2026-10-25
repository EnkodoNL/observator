// SPDX-License-Identifier: FSL-1.1-ALv2

/** The image tag to pin for a Node version, matching the base image family that reported. */
export function pinnedImage(version: string, os: string): string {
  return `node:${version}-${os === "alpine" ? "alpine" : "slim"}`;
}
