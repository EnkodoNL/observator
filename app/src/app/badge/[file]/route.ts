// SPDX-License-Identifier: FSL-1.1-ALv2
import { BADGE_COLORS, badgeSvg } from "@/lib/badge";
import { safeEqual } from "@/lib/crypto";
import { getProjectBySlug } from "@/lib/data/projects";
import { activeIssues } from "@/lib/data/views";
import { getSettings } from "@/lib/settings";
import { summarize } from "@/lib/status";
import { latestBuild } from "@/lib/ingest/ingest";

export const dynamic = "force-dynamic";

const svg = (body: string, cache: string) =>
  new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });

/**
 * GET /badge/<slug>.svg?token=<badge token>: project status for a README. Without a valid
 * token it renders "unknown", so it does not reveal whether a project exists.
 */
/** "node update" or "node eol", for the first runtime that needs attention. */
function runtimeBadge(s: ReturnType<typeof summarize>): string {
  const issue = s.runtimeSecurity[0] ?? s.runtimeEol[0];
  const runtime = (issue?.data as { runtime?: string } | null)?.runtime ?? "runtime";
  return `${runtime} ${s.runtimeSecurity.length ? "update" : "eol"}`;
}

export async function GET(request: Request, { params }: RouteContext<"/badge/[file]">) {
  const { file } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const slug = file.endsWith(".svg") ? file.slice(0, -4) : null;
  const project = slug ? await getProjectBySlug(slug) : null;
  if (!project || !token || !safeEqual(token, project.badgeToken)) {
    return svg(badgeSvg("observator", "unknown", BADGE_COLORS.none), "no-store");
  }

  const [build, issues, settings] = await Promise.all([
    latestBuild(project.id),
    activeIssues(project.id),
    getSettings(),
  ]);
  const s = summarize(Boolean(build), issues, settings.countDevDependencies);
  const [value, color] =
    s.status === "vulnerable"
      ? [`${s.vulnCount} vulnerable`, BADGE_COLORS.vulnerable]
      : s.status === "update"
        ? [runtimeBadge(s), BADGE_COLORS.update]
        : s.status === "ok"
          ? ["ok", BADGE_COLORS.ok]
          : ["no builds", BADGE_COLORS.none];
  return svg(badgeSvg("observator", value, color), "public, max-age=300");
}
