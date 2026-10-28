// SPDX-License-Identifier: FSL-1.1-ALv2
import { appBoard, findApp } from "@/lib/app-board";
import { badgeResponse, badgeSvg, badgeValue, runtimeBadge, unknownBadge } from "@/lib/badge";
import { storedAppBadgeToken } from "@/lib/badges";
import { safeEqual } from "@/lib/crypto";
import { getOverview } from "@/lib/data/views";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /badge/app/<app id>.svg?token=<badge token>: one app over all its projects and servers,
 * for the app's README. Like the project badge, "unknown" without a valid token.
 */
export async function GET(request: Request, { params }: RouteContext<"/badge/app/[file]">) {
  const { file } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const id = file.endsWith(".svg") ? file.slice(0, -4) : "";
  const stored = id && token ? await storedAppBadgeToken(id) : null;
  if (!stored || !safeEqual(token, stored)) return unknownBadge();

  const [items, settings] = await Promise.all([getOverview(), getSettings()]);
  const app = findApp(appBoard(items, settings.staleDays), id);
  if (!app) return unknownBadge();

  const servers = app.services.flatMap((s) => s.servers);
  const runtime = servers.map((i) => runtimeBadge(i.summary)).find(Boolean) ?? null;
  const { value, color } = badgeValue({ status: app.status, counts: app.counts, runtime });
  return badgeResponse(badgeSvg("observator", value, color), "public, max-age=300");
}
