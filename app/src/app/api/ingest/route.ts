// SPDX-License-Identifier: FSL-1.1-ALv2
import { after } from "next/server";
import { env } from "@/lib/env";
import { recordRefused, touchIngestKey } from "@/lib/data/ingest-keys";
import { analyzeInBackground, analyzeInline } from "@/lib/ingest/analyze";
import { recordBuild } from "@/lib/ingest/ingest";
import { matchAddress, matchKey, resolveSharedProject } from "@/lib/ingest/resolve";
import { clientIpFrom } from "@/lib/client-ip";
import { reportedName } from "@/lib/ingest/source";
import { parsePackageJson } from "@/lib/lockfile";
import { publish } from "@/lib/notify/publish";
import { refreshLatest } from "@/lib/npm-latest";
import { renderReport } from "@/lib/ingest/report";
import { extractFiles, IngestError, parseMeta, readBody } from "@/lib/ingest/request";
import { RateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const g = globalThis as typeof globalThis & {
  __ingestLimits?: { perProject: RateLimiter; perSharedKey: RateLimiter; badKey: RateLimiter };
};
// Created lazily: env() must not run at import time (next build imports route modules).
const getLimits = () =>
  (g.__ingestLimits ??= {
    perProject: RateLimiter.perWindow(env().INGEST_RATE_LIMIT, HOUR),
    // A shared key serves many projects; each of them still has its own per-project limit.
    perSharedKey: RateLimiter.perWindow(env().INGEST_RATE_LIMIT * 20, HOUR),
    badKey: RateLimiter.perWindow(30, 10 * 60 * 1000),
  });

const text = (status: number, body: string) =>
  new Response(body.endsWith("\n") ? body : `${body}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/** Enough of a key to recognise it in a log, or an unresolved "{{team.X}}" reference. */
const keyHint = (key: string) => (key.length > 9 ? `${key.slice(0, 9)}…` : key);

/**
 * Receives a tar.gz with package.json + lockfile from the Dockerfile snippet.
 * Excluded from proxy.ts on purpose (the proxy would buffer and truncate the body).
 */
export async function POST(request: Request) {
  const ip = clientIpFrom(request.headers, env().TRUSTED_PROXIES);
  // OBSERVATOR_PROJECT as sent, to recognise the build in logs; validated later for real use.
  const sent = request.headers.get("x-project")?.trim() ?? "";
  const sentName = /^[\x20-\x7e]{1,100}$/.test(sent) ? sent : "";

  /**
   * A report that is not recorded. Answered with 200 on purpose: BusyBox wget and curl -f drop
   * the body of an error response, and the reason is only useful in the build log. The status
   * it deserved goes to the server log, with the address, so both sides can see what happened.
   * `refusal` also lists the address under Settings, to add it to an allowlist.
   */
  const notRecorded = async (status: number, reason: string, refusal?: string) => {
    console.warn(
      `[ingest] not recorded (${status}) from ${ip}${sentName ? `, project "${sentName}"` : ""}: ${reason}`,
    );
    if (refusal && ip !== "unknown") await recordRefused(ip, sentName, refusal);
    return text(200, `Observator: not recorded: ${reason}`);
  };

  try {
    // The snippet without a key check sends "Bearer " with nothing after it: that is no key.
    const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];

    const limits = getLimits();
    if (!limits.badKey.take(`probe:${ip}`))
      return notRecorded(429, `too many refused reports from ${ip}; try again in a few minutes`);
    const byKey = key ? await matchKey(key) : null;
    // An allowed address reports as its shared key, also when a stale or unresolved key comes along.
    const byAddress = byKey ? null : await matchAddress(ip);
    const match = byKey ?? byAddress;
    if (!match) {
      const what = key
        ? `unknown key ${keyHint(key)}${key.startsWith("{{") ? " (an unresolved Coolify reference?)" : ""}`
        : "no key";
      return notRecorded(
        401,
        `${what}, and ${ip} is not on an IP allowlist. Add the address under Settings → Projects → Shared keys, ` +
          `or ${key ? "fix" : "set"} OBSERVATOR_KEY.`,
        key ? `unknown key ${keyHint(key)}` : "no key",
      );
    }
    limits.badKey.reset(`probe:${ip}`);
    const ignoredKey =
      key && byAddress?.kind === "shared"
        ? `Observator: WARN key ${keyHint(key)} is unknown; recorded because ${ip} is on the IP allowlist of ` +
          `"${byAddress.key.name}". Fix or remove OBSERVATOR_KEY.\n`
        : "";
    if (ignoredKey)
      console.warn(`[ingest] unknown key ${keyHint(key!)} from ${ip}, accepted by its IP allowlist`);

    const limited = () =>
      notRecorded(429, `rate limit of ${env().INGEST_RATE_LIMIT} reports per hour exceeded`);
    if (match.kind === "project" && !limits.perProject.take(match.project.id)) return limited();
    if (match.kind === "shared" && !limits.perSharedKey.take(match.key.id)) return limited();

    const meta = parseMeta(request.headers);
    const files = extractFiles(await readBody(request, env().INGEST_MAX_BYTES));

    // A project key decides the project; a shared key names it (and may create it).
    let project = match.kind === "project" ? match.project : null;
    let created: string | null = null;
    if (match.kind === "shared") {
      const pkg = (() => {
        try {
          return parsePackageJson(files.packageJson);
        } catch {
          return null;
        }
      })();
      const resolved = await resolveSharedProject(
        match.key,
        reportedName(request.headers.get("x-project"), pkg),
        ip,
      );
      project = resolved.project;
      if (resolved.created) created = match.key.name;
      else if (!limits.perProject.take(project.id)) return limited();
      await touchIngestKey(match.key.id, ip);
    }
    if (!project) throw new Error("unreachable: no project resolved");

    const outcome = await recordBuild(project, files, meta, ip);
    const analysis = await analyzeInline(project, outcome, meta);

    // Notifications never hold up the build: OSV lookups and sending happen after the response.
    const projectId = project.id;
    after(async () => {
      try {
        await publish(await analyzeInBackground(projectId, analysis));
        if (outcome.lockfileChanged) await refreshLatest(outcome.directNames);
      } catch (err) {
        console.error("[ingest] background analysis failed", err);
      }
    });

    return text(
      200,
      ignoredKey +
        renderReport({
          projectName: project.name,
          createdVia: created ?? undefined,
          projectUrl: `${env().APP_URL}/projects/${project.slug}`,
          nodeVersion: meta.nodeVersion,
          platform: [meta.platform, meta.arch].filter(Boolean).join("/"),
          lockfileType: outcome.build.lockfileType,
          packageCount: outcome.packageCount,
          lockfileChanged: outcome.lockfileChanged,
          parseError: outcome.parseError,
          warnings: analysis.warnings,
          packagesPending: analysis.packagesPending,
          gate: analysis.gate,
          gateReason: analysis.gateReason,
        }),
    );
  } catch (err) {
    if (err instanceof IngestError) return notRecorded(err.status, err.message);
    console.error("[ingest] failed", err);
    return text(500, "Observator: internal error");
  }
}
