// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { DomainEvent } from "@/lib/issues/events";
import { mapLimit } from "@/lib/map-limit";
import { publishDomainEvents } from "@/lib/notify/publish";
import { adminPb } from "@/lib/pb/admin";
import type { DomainRecord, ProjectRecord, RegistrationInfo } from "@/lib/pb/types";
import { getSettings } from "@/lib/settings";
import { checkCert } from "./cert";
import { coolifyNames } from "./coolify";
import { listDomains, syncHosts, type WatchedDomain } from "./data";
import { certPhase, nextAlert, registrationExpiry, registrationPhase, type Limits } from "./phase";
import { lookupRegistration } from "./rdap";

const DAY = 86_400_000;

/**
 * Whether the registry should be asked again. Expiry dates rarely change and registries limit
 * hard, so a week, or daily once the date is within two months (a renewal shows up quickly).
 */
export function registrationDue(info: RegistrationInfo | null, now: Date): boolean {
  if (!info) return true;
  const age = now.getTime() - new Date(info.checkedAt).getTime();
  if (info.source === "failed") return age >= DAY;
  if (age >= 7 * DAY) return true;
  return (
    Boolean(info.expiresAt) && new Date(info.expiresAt!).getTime() - now.getTime() < 60 * DAY && age >= DAY
  );
}

/** A failed lookup keeps the date from the last good one: one bad day must not forget an expiry. */
function merge(previous: RegistrationInfo | null, fresh: RegistrationInfo): RegistrationInfo {
  if (fresh.source !== "failed" || !previous?.expiresAt) return fresh;
  return { ...previous, error: fresh.error, checkedAt: fresh.checkedAt };
}

async function checkRegistration(domain: DomainRecord, now: Date, force: boolean): Promise<void> {
  if (!force && !registrationDue(domain.registration, now)) return;
  const registration = merge(domain.registration, await lookupRegistration(domain.name));
  const pb = await adminPb();
  await pb.collection("domains").update(domain.id, { registration });
  domain.registration = registration;
}

/** Phases after the checks; saves what changed and returns what to announce. */
async function alerts(watched: WatchedDomain[], limits: Limits, now: Date): Promise<DomainEvent[]> {
  const pb = await adminPb();
  const events: DomainEvent[] = [];
  const occurredAt = now.toISOString();
  for (const { domain, hosts } of watched) {
    const reg = nextAlert(domain.alert, registrationPhase(domain, limits, now));
    if (JSON.stringify(reg.alert) !== JSON.stringify(domain.alert))
      await pb.collection("domains").update(domain.id, { alert: reg.alert });
    if (reg.notify)
      events.push({
        type: "domain.expiring",
        target: "registration",
        name: domain.name,
        phase: reg.alert.phase,
        expiresAt: registrationExpiry(domain),
        error: "",
        note: domain.note,
        projectIds: [...new Set(hosts.map((h) => h.project).filter(Boolean))],
        occurredAt,
      });
    for (const host of hosts) {
      const cert = nextAlert(host.alert, certPhase(host.cert, now));
      if (JSON.stringify(cert.alert) !== JSON.stringify(host.alert))
        await pb.collection("hosts").update(host.id, { alert: cert.alert });
      if (cert.notify)
        events.push({
          type: "domain.expiring",
          target: "certificate",
          name: host.name,
          phase: cert.alert.phase,
          expiresAt: host.cert?.expiresAt ?? null,
          error: host.cert?.error ?? "",
          note: domain.note,
          projectIds: host.project ? [host.project] : [],
          occurredAt,
        });
    }
  }
  return events;
}

/** Projects deployed by Coolify bring their domains along; a failed read leaves them as they were. */
async function syncCoolify(): Promise<void> {
  const pb = await adminPb();
  const projects = await pb.collection("projects").getFullList<ProjectRecord>({
    filter: 'deployWebhookUrl != ""',
    fields: "id,deployWebhookUrl,deployWebhookToken",
  });
  for (const p of projects) {
    const names = await coolifyNames(p).catch((err) => {
      console.error(`[domains] Coolify read failed for project ${p.id}`, err);
      return null;
    });
    if (names) await syncHosts(p.id, "coolify", names);
  }
}

/**
 * Checks certificates (every run) and registrations (when due), then announces what got worse.
 * `domainId` limits it to one domain, right after it was added or changed.
 */
export async function checkDomains({ force = false, domainId }: { force?: boolean; domainId?: string } = {}) {
  if (!domainId) await syncCoolify();
  const now = new Date();
  const settings = await getSettings();
  const watched = (await listDomains()).filter((w) => !domainId || w.domain.id === domainId);
  const pb = await adminPb();

  const hosts = watched.flatMap((w) => w.hosts);
  await mapLimit(hosts, 4, async (host) => {
    host.cert = await checkCert(host.name);
    await pb.collection("hosts").update(host.id, { cert: host.cert });
  });
  // One at a time: lookups to the same registry are spaced out (rdap.ts).
  for (const { domain } of watched) await checkRegistration(domain, now, force || Boolean(domainId));

  const events = await alerts(
    watched,
    { warnDays: settings.domainWarnDays, urgentDays: settings.domainUrgentDays },
    now,
  );
  await publishDomainEvents(events);
  return { hosts: hosts.length, domains: watched.length, announced: events.length };
}
