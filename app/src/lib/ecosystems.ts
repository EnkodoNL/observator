// SPDX-License-Identifier: FSL-1.1-ALv2

/*
 * Package ecosystems beyond the ones OSV knows (npm, Go), client-safe for labels. An app in a
 * Coolify service is named by its GitHub repository; a package Coolify's own image scan found is
 * "coolify:<type>" (coolify:deb, coolify:npm, ...).
 */

export const GITHUB_ECOSYSTEM = "GitHub";
export const COOLIFY_ECOSYSTEM = "coolify:";

export const isCoolifyEcosystem = (ecosystem: string | undefined) =>
  Boolean(ecosystem?.startsWith(COOLIFY_ECOSYSTEM));

/** "deb" from "coolify:deb". */
export const coolifyPackageType = (ecosystem: string | undefined) =>
  (ecosystem ?? "").slice(COOLIFY_ECOSYSTEM.length);
