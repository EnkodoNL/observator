// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { adminPb, isNotFound, toPbDate } from "@/lib/pb/admin";
import type { DomainRecord, HostRecord, HostSource } from "@/lib/pb/types";
import type { ParsedName } from "./names";

export interface WatchedDomain {
  domain: DomainRecord;
  hosts: HostRecord[];
}

/** Every watched domain with its hosts, by name. */
export async function listDomains(): Promise<WatchedDomain[]> {
  const pb = await adminPb();
  const [domains, hosts] = await Promise.all([
    pb.collection("domains").getFullList<DomainRecord>({ sort: "name" }),
    pb.collection("hosts").getFullList<HostRecord>({ sort: "name" }),
  ]);
  return domains.map((domain) => ({ domain, hosts: hosts.filter((h) => h.domain === domain.id) }));
}

export async function hostsOfProject(projectId: string): Promise<HostRecord[]> {
  const pb = await adminPb();
  return pb.collection("hosts").getFullList<HostRecord>({
    filter: pb.filter("project = {:p}", { p: projectId }),
    sort: "name",
  });
}

async function findBy<T>(collection: string, name: string): Promise<T | null> {
  const pb = await adminPb();
  try {
    return await pb.collection(collection).getFirstListItem<T>(pb.filter("name = {:n}", { n: name }));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** The registered domain's record, created when missing. `manual`: someone added it by hand. */
async function ensureDomain(name: string, manual: boolean): Promise<DomainRecord> {
  const pb = await adminPb();
  const existing = await findBy<DomainRecord>("domains", name);
  if (existing) {
    if (manual && !existing.manual)
      return pb.collection("domains").update<DomainRecord>(existing.id, { manual });
    return existing;
  }
  return pb.collection("domains").create<DomainRecord>({ name, manual, remindDays: 0 });
}

export interface AddInput {
  name: ParsedName;
  /** Also check the certificate when the name is a registered domain itself. */
  checkCert: boolean;
  project?: string;
}

/**
 * Starts watching a name. A subdomain is a host (its certificate) under its registered domain
 * (the registration); a registered domain is watched for its registration, and as a host too
 * when its certificate should be checked.
 */
export async function addName({ name, checkCert, project }: AddInput, source: HostSource = "manual") {
  const isDomain = name.host === name.domain;
  const domain = await ensureDomain(name.domain, isDomain && source === "manual");
  const host = !isDomain || checkCert ? await ensureHost(name.host, domain.id, source, project) : null;
  return { domain, host };
}

async function ensureHost(
  name: string,
  domainId: string,
  source: HostSource,
  project?: string,
): Promise<HostRecord> {
  const pb = await adminPb();
  const existing = await findBy<HostRecord>("hosts", name);
  if (!existing)
    return pb
      .collection("hosts")
      .create<HostRecord>({ name, domain: domainId, project: project ?? "", sources: [source] });
  const sources = [...new Set([...(existing.sources ?? []), source])];
  return pb.collection("hosts").update<HostRecord>(existing.id, {
    sources,
    // A project given now wins; otherwise it keeps the one it had.
    ...(project ? { project } : {}),
  });
}

export async function updateDomain(
  id: string,
  data: Partial<Pick<DomainRecord, "note" | "remindDays" | "manualExpiresAt">>,
): Promise<DomainRecord> {
  const pb = await adminPb();
  const patch = {
    ...data,
    ...(data.manualExpiresAt !== undefined
      ? { manualExpiresAt: data.manualExpiresAt ? toPbDate(new Date(data.manualExpiresAt)) : "" }
      : {}),
  };
  return pb.collection("domains").update<DomainRecord>(id, patch);
}

export async function setHostProject(id: string, project: string): Promise<HostRecord> {
  const pb = await adminPb();
  return pb.collection("hosts").update<HostRecord>(id, { project });
}

/** Stops watching a host; its domain goes too when nothing else keeps it. */
export async function removeHost(id: string): Promise<void> {
  const pb = await adminPb();
  const host = await pb.collection("hosts").getOne<HostRecord>(id);
  await pb.collection("hosts").delete(id);
  await dropIfUnused(host.domain);
}

/** Stops watching a domain and every host under it. */
export async function removeDomain(id: string): Promise<void> {
  const pb = await adminPb();
  await pb.collection("domains").delete(id);
}

async function dropIfUnused(domainId: string): Promise<void> {
  const pb = await adminPb();
  const domain = await pb
    .collection("domains")
    .getOne<DomainRecord>(domainId)
    .catch(() => null);
  if (!domain || domain.manual) return;
  const left = await pb
    .collection("hosts")
    .getList(1, 1, { filter: pb.filter("domain = {:d}", { d: domainId }), fields: "id" });
  if (left.totalItems === 0) await pb.collection("domains").delete(domainId);
}

/**
 * Makes a project's hosts from one source (a build, Coolify) exactly `names`: new ones are added,
 * gone ones lose that source, and are dropped when no other source keeps them. Returns the
 * domains that got a new host, to check right away.
 */
export async function syncHosts(
  projectId: string,
  source: Exclude<HostSource, "manual">,
  names: ParsedName[],
): Promise<string[]> {
  const pb = await adminPb();
  const wanted = new Set(names.map((n) => n.host));
  const before = new Set((await hostsOfProject(projectId)).map((h) => h.name));
  const fresh = new Set<string>();
  for (const n of names) {
    const domain = await ensureDomain(n.domain, false);
    await ensureHost(n.host, domain.id, source, projectId);
    if (!before.has(n.host)) fresh.add(domain.id);
  }
  const current = (await hostsOfProject(projectId)).filter((h) => h.sources?.includes(source));
  for (const host of current) {
    if (wanted.has(host.name)) continue;
    const sources = (host.sources ?? []).filter((s) => s !== source);
    if (sources.length) await pb.collection("hosts").update(host.id, { sources });
    else await removeHost(host.id);
  }
  return [...fresh];
}
