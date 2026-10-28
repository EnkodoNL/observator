// SPDX-License-Identifier: FSL-1.1-ALv2
import { badgeResponse, badgeSvg, badgeValue, runtimeBadge, unknownBadge } from "@/lib/badge";
import { safeEqual } from "@/lib/crypto";
import { getProjectBySlug } from "@/lib/data/projects";
import { activeIssues } from "@/lib/data/views";
import { getSettings } from "@/lib/settings";
import { summarize } from "@/lib/status";
import { latestBuild } from "@/lib/ingest/ingest";

export const dynamic = "force-dynamic";

/**
 * GET /badge/<slug>.svg?token=<badge token>: project status for a README. Without a valid
 * token it renders "unknown", so it does not reveal whether a project exists.
 */
export async function GET(request: Request, { params }: RouteContext<"/badge/[file]">) {
  const { file } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const slug = file.endsWith(".svg") ? file.slice(0, -4) : null;
  const project = slug ? await getProjectBySlug(slug) : null;
  if (!project || !token || !safeEqual(token, project.badgeToken)) return unknownBadge();

  const [build, issues, settings] = await Promise.all([
    latestBuild(project.id),
    activeIssues(project.id),
    getSettings(),
  ]);
  const s = summarize(Boolean(build), issues, settings.countDevDependencies);
  const { value, color } = badgeValue({
    status: s.status,
    counts: s.vulnBySeverity,
    runtime: runtimeBadge(s),
  });
  return badgeResponse(badgeSvg("observator", value, color), "public, max-age=300");
}
