// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { checkOutbound, isRedirect } from "@/lib/outbound";
import type { ImageRef } from "./reference";

/*
 * Reads an image's config (labels and environment) from its registry, anonymously, through the
 * Docker registry API every registry speaks: Docker Hub, GHCR and the rest. Only public images
 * can be read; a private one answers 401 and is reported as such.
 */

const MANIFESTS = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const MAX_BODY = 2_000_000;
const TIMEOUT = 15_000;

export interface ImageConfig {
  labels: Record<string, string>;
  env: Record<string, string>;
}

export class RegistryError extends Error {}

/** realm, service and scope from `Bearer realm="…",service="…",scope="…"`. */
export function parseChallenge(header: string | null): Record<string, string> | null {
  if (!header || !/^bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const m of header.slice(7).matchAll(/([a-z_]+)="([^"]*)"/gi)) params[m[1].toLowerCase()] = m[2];
  return params.realm ? params : null;
}

/** GET with the outbound guard on every hop; a redirect to another host drops the token. */
async function get(url: string, headers: Record<string, string>): Promise<Response> {
  let target = url;
  let auth: string | undefined = headers.authorization;
  for (let hop = 0; hop < 4; hop++) {
    const checked = await checkOutbound(target);
    const res = await fetch(checked.href, {
      headers: { ...headers, ...(auth ? { authorization: auth } : {}), "user-agent": "observator" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const location = res.headers.get("location");
    if (!isRedirect(res.status) || !location) return res;
    const next = new URL(location, checked);
    if (next.host !== checked.host) auth = undefined;
    target = next.href;
  }
  throw new RegistryError("too many redirects");
}

async function json(res: Response): Promise<unknown> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new RegistryError("response too large");
  const text = await res.text();
  if (text.length > MAX_BODY) throw new RegistryError("response too large");
  return JSON.parse(text);
}

const pairs = (list: unknown): Record<string, string> =>
  Object.fromEntries(
    (Array.isArray(list) ? list : []).flatMap((e) => {
      if (typeof e !== "string" || !e.includes("=")) return [];
      const at = e.indexOf("=");
      return [[e.slice(0, at), e.slice(at + 1).slice(0, 500)]];
    }),
  );

const strings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v.slice(0, 500)]] : [],
    ),
  );

/** The linux/amd64 config of an image: what its tag (or digest) points to right now. */
export async function fetchImageConfig(ref: ImageRef): Promise<ImageConfig> {
  const base = `https://${ref.registry}/v2/${ref.repository}`;
  let token: string | null = null;

  const request = async (path: string, accept: string): Promise<unknown> => {
    const headers = { accept, ...(token ? { authorization: `Bearer ${token}` } : {}) };
    let res = await get(`${base}/${path}`, headers);
    if (res.status === 401 && !token) {
      const challenge = parseChallenge(res.headers.get("www-authenticate"));
      if (!challenge) throw new RegistryError("the registry wants credentials");
      const tokenUrl = new URL(challenge.realm);
      if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
      tokenUrl.searchParams.set("scope", challenge.scope ?? `repository:${ref.repository}:pull`);
      const answer = (await json(await get(tokenUrl.href, { accept: "application/json" }))) as {
        token?: unknown;
        access_token?: unknown;
      };
      const issued = typeof answer.token === "string" ? answer.token : answer.access_token;
      if (typeof issued !== "string") throw new RegistryError("no token from the registry");
      token = issued;
      res = await get(`${base}/${path}`, { accept, authorization: `Bearer ${token}` });
    }
    if (res.status === 401 || res.status === 403)
      throw new RegistryError("not public: the registry wants credentials");
    if (res.status === 404) throw new RegistryError("no such image or tag");
    if (!res.ok) throw new RegistryError(`registry answered HTTP ${res.status}`);
    return json(res);
  };

  let manifest = (await request(`manifests/${ref.digest ?? ref.tag}`, MANIFESTS)) as {
    manifests?: { digest: string; platform?: { os?: string; architecture?: string } }[];
    config?: { digest: string };
  };
  if (Array.isArray(manifest.manifests)) {
    const pick =
      manifest.manifests.find((m) => m.platform?.os === "linux" && m.platform.architecture === "amd64") ??
      manifest.manifests.find((m) => m.platform?.os !== "unknown");
    if (!pick?.digest) throw new RegistryError("no linux image in the index");
    manifest = (await request(`manifests/${pick.digest}`, MANIFESTS)) as typeof manifest;
  }
  if (!manifest.config?.digest || !/^sha256:[a-f0-9]{64}$/.test(manifest.config.digest))
    throw new RegistryError("the manifest has no config");
  const blob = (await request(`blobs/${manifest.config.digest}`, "*/*")) as {
    config?: { Labels?: unknown; Env?: unknown };
  };
  return { labels: strings(blob.config?.Labels), env: pairs(blob.config?.Env) };
}
