// SPDX-License-Identifier: FSL-1.1-ALv2
import { after } from "next/server";
import { env } from "@/lib/env";
import { touchIngestKey } from "@/lib/data/ingest-keys";
import { analyzeInBackground, analyzeInline } from "@/lib/ingest/analyze";
import { recordBuild } from "@/lib/ingest/ingest";
import { matchKey, resolveSharedProject } from "@/lib/ingest/resolve";
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

/**
 * Receives a tar.gz with package.json + lockfile from the Dockerfile snippet.
 * Excluded from proxy.ts on purpose (the proxy would buffer and truncate the body).
 */
export async function POST(request: Request) {
  try {
    const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!key) return text(401, "Observator: missing Authorization: Bearer <key>");

    const limits = getLimits();
    const ip = clientIpFrom(request.headers, env().TRUSTED_PROXIES);
    if (!limits.badKey.take(`probe:${ip}`)) return text(429, "Observator: too many requests");
    const match = await matchKey(key);
    if (!match) return text(401, "Observator: unknown key");
    limits.badKey.reset(`probe:${ip}`);

    const limited = text(
      429,
      `Observator: rate limit of ${env().INGEST_RATE_LIMIT} reports per hour exceeded`,
    );
    if (match.kind === "project" && !limits.perProject.take(match.project.id)) return limited;
    if (match.kind === "shared" && !limits.perSharedKey.take(match.key.id)) return limited;

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
      else if (!limits.perProject.take(project.id)) return limited;
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
    if (err instanceof IngestError) return text(err.status, `Observator: ${err.message}`);
    console.error("[ingest] failed", err);
    return text(500, "Observator: internal error");
  }
}
