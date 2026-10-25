// SPDX-License-Identifier: FSL-1.1-ALv2
import { after } from "next/server";
import { env } from "@/lib/env";
import { getProjectByKey } from "@/lib/data/projects";
import { analyzeInBackground, analyzeInline } from "@/lib/ingest/analyze";
import { recordBuild } from "@/lib/ingest/ingest";
import { publish } from "@/lib/notify/publish";
import { renderReport } from "@/lib/ingest/report";
import { extractFiles, IngestError, parseMeta, readBody } from "@/lib/ingest/request";
import { RateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const g = globalThis as typeof globalThis & {
  __ingestLimits?: { perProject: RateLimiter; badKey: RateLimiter };
};
// Created lazily: env() must not run at import time (next build imports route modules).
const getLimits = () =>
  (g.__ingestLimits ??= {
    perProject: RateLimiter.perWindow(env().INGEST_RATE_LIMIT, HOUR),
    badKey: RateLimiter.perWindow(30, 10 * 60 * 1000),
  });

const text = (status: number, body: string) =>
  new Response(body.endsWith("\n") ? body : `${body}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Receives a tar.gz with package.json + lockfile from the Dockerfile snippet.
 * Excluded from proxy.ts on purpose (the proxy would buffer and truncate the body).
 */
export async function POST(request: Request) {
  try {
    const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!key) return text(401, "Observator: missing Authorization: Bearer <project key>");

    const limits = getLimits();
    const ip = clientIp(request);
    if (!limits.badKey.take(`probe:${ip}`)) return text(429, "Observator: too many requests");
    const project = await getProjectByKey(key);
    if (!project) return text(401, "Observator: unknown project key");
    limits.badKey.reset(`probe:${ip}`);

    if (!limits.perProject.take(project.id)) {
      return text(429, `Observator: rate limit of ${env().INGEST_RATE_LIMIT} reports per hour exceeded`);
    }

    const meta = parseMeta(request.headers);
    const files = extractFiles(await readBody(request, env().INGEST_MAX_BYTES));
    const outcome = await recordBuild(project, files, meta);
    const analysis = await analyzeInline(project, outcome, meta);

    // Notifications never hold up the build: OSV lookups and sending happen after the response.
    after(async () => {
      try {
        await publish(await analyzeInBackground(project.id, analysis));
      } catch (err) {
        console.error("[ingest] background analysis failed", err);
      }
    });

    return text(
      200,
      renderReport({
        projectName: project.name,
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
