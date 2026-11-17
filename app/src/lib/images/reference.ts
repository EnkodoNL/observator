// SPDX-License-Identifier: FSL-1.1-ALv2

/** An image reference as Coolify keeps it ("mariadb:11", "ghcr.io/acme/app:2.1"), taken apart. */
export interface ImageRef {
  /** As given, for showing. */
  raw: string;
  /** The registry's API host: registry-1.docker.io for Docker Hub. */
  registry: string;
  /** The repository on that registry: "library/mariadb" for Docker Hub's official images. */
  repository: string;
  /** "latest" when none is given. */
  tag: string;
  digest: string | null;
  /** The repository as people write it: "mariadb", "ghcr.io/acme/app". */
  name: string;
}

const DOCKER_HUB = "registry-1.docker.io";

/** Parses an image reference, or null for one Observator would not ask a registry about. */
export function parseImageRef(raw: string): ImageRef | null {
  const input = raw.trim();
  if (!input || /\s/.test(input) || input.length > 500) return null;
  const [rest, digest = null] = input.split("@", 2) as [string, string?];
  if (digest !== null && !/^sha256:[a-f0-9]{64}$/.test(digest)) return null;

  // A tag follows the last colon after the last slash; a colon before it is a registry port.
  const slash = rest.lastIndexOf("/");
  const colon = rest.lastIndexOf(":");
  const tag = colon > slash ? rest.slice(colon + 1) : "latest";
  const path = colon > slash ? rest.slice(0, colon) : rest;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) return null;

  const segments = path.split("/");
  const first = segments[0];
  const hasRegistry =
    segments.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost");
  const host = hasRegistry ? first.toLowerCase() : "docker.io";
  // Docker refuses capitals in a repository name; so does this.
  let repository = (hasRegistry ? segments.slice(1) : segments).join("/");
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(repository)) return null;

  const hub = host === "docker.io" || host === "index.docker.io" || host === DOCKER_HUB;
  if (hub && !repository.includes("/")) repository = `library/${repository}`;
  const name = hub ? repository.replace(/^library\//, "") : `${host}/${repository}`;
  return { raw: input, registry: hub ? DOCKER_HUB : host, repository, tag, digest: digest ?? null, name };
}
