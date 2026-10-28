// SPDX-License-Identifier: FSL-1.1-ALv2

/** The origin of a URL, or the value itself when it is not one: what a stored secret is bound to. */
export function urlOrigin(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

/**
 * A URL without what tends to carry credentials (user:password@, the query), for showing it.
 * Returns the URL unchanged when there is nothing to hide or it is not a URL.
 */
export function maskUrlSecrets(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (!url.username && !url.password && !url.search) return value;
  return `${url.protocol}//${url.username || url.password ? "…@" : ""}${url.host}${url.pathname}${url.search ? "?…" : ""}`;
}
