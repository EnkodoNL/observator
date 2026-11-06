// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * The golang image to pin in the stage that builds the program. The reporting image says nothing
 * about that stage's variant (scratch and distroless report no os), so the tag is bare.
 */
export function pinnedGoImage(version: string): string {
  return `golang:${version}`;
}
