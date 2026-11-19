// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { randomToken, sha256 } from "@/lib/crypto";
import { uniqueSlug } from "@/lib/data/projects";
import type { ImageInventory } from "@/lib/images/describe";
import { inspectImage } from "@/lib/images/inspect";
import { analyzeInBackground, analyzeInline } from "@/lib/ingest/analyze";
import { latestBuild, recordBuild, reportHash } from "@/lib/ingest/ingest";
import type { IngestMeta } from "@/lib/ingest/request";
import { evaluateProject } from "@/lib/issues/evaluate";
import type { IssueEvent } from "@/lib/issues/events";
import { kvSet } from "@/lib/kv";
import { mapLimit } from "@/lib/map-limit";
import { publish } from "@/lib/notify/publish";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { CoolifyServerRecord, ProjectRecord } from "@/lib/pb/types";
import type { Runtime } from "@/lib/runtimes/types";
import { slugify } from "@/lib/slug";
import { repoAdvisories, repoReleases } from "@/lib/github/client";
import { affects, type Verdict } from "@/lib/github/ranges";
import { newestIn } from "@/lib/github/repos";
import type { Component } from "@/lib/lockfile/types";
import { GITHUB } from "@/lib/osv/check";
import { listDatabases, listServices, resourceScan, serviceImages } from "./client";
import { FindingStore, findingComponents, findingCounts, isCoolifyEcosystem } from "./findings";
import {
  inventoryKey,
  resourceInventory,
  syncStatusKey,
  type AppInventory,
  type ResourceInventory,
  type ResourceKind,
  type ResourceSyncStatus,
} from "./inventory";
import { listServers, serverAccess } from "./servers";

/*
 * Coolify's databases and services as projects. They have no Dockerfile, so no snippet reports
 * them; instead their images are read from the registry (version, runtimes inside, source) and
 * recorded as a build, the way Observator records itself. Only the read permission is used.
 */

interface Listed {
  kind: ResourceKind;
  uuid: string;
  name: string;
  type: string;
  parts: { part: string; image: string }[];
  error: string | null;
}

/** The runtimes a resource records: each image's product (MariaDB, ...) and what runs inside. */
export function resourceRuntimes(images: readonly ImageInventory[]): Runtime[] {
  const out: Runtime[] = [];
  const add = (r: Runtime) => {
    if (!out.some((o) => o.name === r.name && o.version === r.version)) out.push(r);
  };
  for (const image of images) {
    if (image.product && image.version) add({ name: image.product, version: image.version });
    for (const r of image.runtimes) add(r);
  }
  return out;
}

/** The same images, whether or not the registry answered this time. */
const sameImages = (a: ResourceInventory["images"], b: ResourceInventory["images"]) => {
  const plain = (list: ResourceInventory["images"]) =>
    JSON.stringify(list.map((i) => ({ ...i, error: null })));
  return plain(a) === plain(b);
};

async function projectFor(
  server: CoolifyServerRecord,
  resource: Listed,
  existing: ProjectRecord[],
): Promise<ProjectRecord> {
  const pb = await adminPb();
  const known = existing.find(
    (p) =>
      p.coolifyServer === server.id && p.coolifyUuid === resource.uuid && p.coolifyKind === resource.kind,
  );
  const name = resource.name.slice(0, 100);
  if (known) {
    if (known.name === name && !known.coolifyGoneAt) return known;
    return pb.collection("projects").update<ProjectRecord>(known.id, { name, coolifyGoneAt: "" });
  }
  return pb.collection("projects").create<ProjectRecord>({
    name,
    slug: await uniqueSlug(slugify(name) || resource.kind),
    // Never used: nothing reports into these projects, the sync records them.
    apiKeyHash: sha256(randomToken(32)),
    apiKeyPrefix: "coolify",
    badgeToken: randomToken(18),
    coolifyServer: server.id,
    coolifyUuid: resource.uuid,
    coolifyKind: resource.kind,
  });
}

/** The app in an image, by its GitHub repository: which version it is, the newest, what is unclear. */
async function appOf(
  image: ResourceInventory["images"][number],
): Promise<{ app: AppInventory; component: Component | null }> {
  const source = image.source!;
  const releases = await repoReleases(source);
  const list = "error" in releases ? [] : releases;
  // A pinned tag is the version; a moving one is assumed to be the newest release in its line.
  const exact = image.pinned ? image.version : null;
  const version = exact ?? image.versionNow ?? newestIn(list, image.version)?.version ?? null;
  const advisories = version ? await repoAdvisories(source) : { error: "" };
  const verdicts =
    version && !("error" in advisories)
      ? advisories.map((a) => ({ id: a.id, verdict: affects(version, a.vulnerable, a.patched) }))
      : [];
  const ids = (v: Verdict) => [...new Set(verdicts.filter((a) => a.verdict === v).map((a) => a.id))];
  const app: AppInventory = {
    part: image.part,
    source,
    version,
    assumed: !exact,
    latest: list[0]?.version ?? null,
    unclear: ids("unclear"),
    contradicts: ids("contradicts"),
    error: "error" in releases ? releases.error : null,
  };
  const component = version
    ? { name: source, version, direct: true, dev: false, via: [], ecosystem: GITHUB }
    : null;
  return { app, component };
}

/** Brings one resource's project up to date; records a build only when what it runs changed. */
async function syncResource(
  server: CoolifyServerRecord,
  access: { base: string; token: string },
  resource: Listed,
  existing: ProjectRecord[],
  store: FindingStore,
): Promise<{ events: IssueEvent[]; scanRead: boolean; scanOff: boolean }> {
  const wasGone = existing.some(
    (p) => p.coolifyServer === server.id && p.coolifyUuid === resource.uuid && Boolean(p.coolifyGoneAt),
  );
  const project = await projectFor(server, resource, existing);
  const inspected = await mapLimit(resource.parts, 4, async ({ part, image }) => {
    const found = await inspectImage(image);
    return found ? [{ ...found, part }] : [];
  });
  const previous = await resourceInventory(project.id);
  // A registry that does not answer this time keeps the last known reading, with the error, so
  // an outage does not flip the recorded versions back and forth.
  const images = inspected.flat().map((image) => {
    if (!image.error) return image;
    const known = previous?.images.find((p) => p.ref === image.ref && p.part === image.part && !p.error);
    return known ? { ...known, error: image.error } : image;
  });
  const runtimes = resourceRuntimes(images);

  // Apps (no product of their own, a repository on GitHub): their own advisories and releases.
  const apps = await mapLimit(
    images.filter((i) => !i.product && i.source),
    2,
    appOf,
  );
  // Coolify's own scan of what runs: its fixable findings are advisories of their own.
  const scan = await resourceScan(access, resource.kind, resource.uuid);
  const scanRead = !("error" in scan);
  let scanComponents: Component[];
  let rowsChanged = false;
  if (scanRead) {
    scanComponents = findingComponents(scan.findings);
    rowsChanged = await store.write(scan.findings);
  } else {
    // Unreadable this time: keep what the last scan gave, rows included.
    scanComponents = (previous?.components ?? []).filter((c) => isCoolifyEcosystem(c.ecosystem ?? ""));
    store.keep(scanComponents);
  }
  const components = [...apps.flatMap((a) => (a.component ? [a.component] : [])), ...scanComponents];

  const inventory: ResourceInventory = {
    kind: resource.kind,
    server: server.name,
    type: resource.type,
    images: resource.error && previous ? previous.images : images,
    apps: apps.map((a) => a.app),
    scan: scanRead
      ? { ...findingCounts(scan.findings), off: scan.off, scannedAt: scan.scannedAt, error: null }
      : {
          ...(previous?.scan ?? { fixable: 0, unfixable: 0, off: null, scannedAt: null }),
          error: scan.error,
        },
    components,
    error: resource.error,
    syncedAt: new Date().toISOString(),
  };
  await kvSet(inventoryKey(project.id), inventory);
  // A service whose parts could not be read keeps what it had.
  const scanOff = scanRead && scan.off !== null;
  if (resource.error) return { events: [], scanRead, scanOff };

  const latest = await latestBuild(project.id);
  const unchanged =
    latest !== null &&
    JSON.stringify(latest.runtimes ?? []) === JSON.stringify(runtimes) &&
    previous !== null &&
    sameImages(previous.images, images) &&
    latest.lockfileHash === reportHash("", null, "", null, components);
  // Back after being gone, or new findings for the same packages: evaluate without a new build.
  if (unchanged)
    return { events: wasGone || rowsChanged ? await evaluateProject(project.id) : [], scanRead, scanOff };

  const meta: IngestMeta = {
    runtimes,
    invalidRuntimes: [],
    platform: "",
    arch: "",
    os: "",
    failOn: { severity: null, runtimes: [] },
    labels: { labels: [`coolify:${resource.kind}`], invalid: [] },
    domains: null,
    reporter: null,
    coolify: null,
  };
  const outcome = await recordBuild(
    project,
    { packageJson: null, lockfiles: {}, goBinaries: null, components },
    meta,
  );
  const analysis = await analyzeInline(project, outcome, meta);
  return { events: await analyzeInBackground(project.id, analysis), scanRead, scanOff };
}

/** Lists a server's databases and services; null for a kind whose listing failed. */
async function listResources(access: { base: string; token: string }): Promise<{
  databases: Listed[] | null;
  services: Listed[] | null;
  error: string | null;
}> {
  const [databases, services] = await Promise.all([listDatabases(access), listServices(access)]);
  const dbs =
    "error" in databases
      ? null
      : databases.map((d) => ({
          kind: "database" as const,
          uuid: d.uuid,
          name: d.name,
          type: d.kind,
          parts: d.image ? [{ part: "", image: d.image }] : [],
          error: null,
        }));
  const svcs =
    "error" in services
      ? null
      : await mapLimit(services, 4, async (s) => {
          const parts = await serviceImages(access, s.uuid);
          return {
            kind: "service" as const,
            uuid: s.uuid,
            name: s.name,
            type: s.type,
            parts: "error" in parts ? [] : parts.map((p) => ({ part: p.name, image: p.image })),
            error: "error" in parts ? parts.error : null,
          };
        });
  const error =
    ("error" in databases ? databases.error : null) ?? ("error" in services ? services.error : null);
  return { databases: dbs, services: svcs, error };
}

/**
 * Syncs every connected Coolify server's databases and services into projects. A resource that a
 * successful listing no longer has is marked gone (its issues close); the sync never deletes.
 */
export async function syncCoolifyResources(): Promise<IssueEvent[]> {
  const pb = await adminPb();
  const servers = await listServers();
  const existing = await pb
    .collection("projects")
    .getFullList<ProjectRecord>({ filter: 'coolifyKind != ""' });
  const events: IssueEvent[] = [];
  // The scan's advisories that no resource has any more go, but only after a sync read them all.
  const store = await FindingStore.open();
  let complete = true;

  for (const server of servers) {
    const access = serverAccess(server);
    const status: ResourceSyncStatus = {
      at: new Date().toISOString(),
      databases: null,
      services: null,
      error: null,
    };
    if (!access) {
      complete = false;
      status.error = "the token cannot be decrypted (SECRETS_KEY)";
      await kvSet(syncStatusKey(server.id), status);
      continue;
    }
    const listed = await listResources(access);
    status.databases = listed.databases?.length ?? null;
    status.services = listed.services?.length ?? null;
    status.error = listed.error;

    if (!listed.databases || !listed.services) complete = false;
    for (const resource of [...(listed.databases ?? []), ...(listed.services ?? [])]) {
      try {
        const result = await syncResource(server, access, resource, existing, store);
        events.push(...result.events);
        if (!result.scanRead) complete = false;
        else if (result.scanOff) status.scanOff = (status.scanOff ?? 0) + 1;
        else status.scanned = (status.scanned ?? 0) + 1;
      } catch (err) {
        complete = false;
        console.error(`[coolify] syncing ${resource.kind} ${resource.uuid} failed`, err);
      }
    }

    // Gone: only judged for a kind whose listing worked, so an outage closes nothing.
    for (const project of existing.filter((p) => p.coolifyServer === server.id && !p.coolifyGoneAt)) {
      const list = project.coolifyKind === "database" ? listed.databases : listed.services;
      if (!list || list.some((r) => r.uuid === project.coolifyUuid)) continue;
      await pb.collection("projects").update(project.id, { coolifyGoneAt: toPbDate(new Date()) });
      events.push(...(await evaluateProject(project.id)));
    }
    await kvSet(syncStatusKey(server.id), status);
  }
  await store.finish(complete);
  await publish(events);
  return events;
}
