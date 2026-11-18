// SPDX-License-Identifier: FSL-1.1-ALv2
import { authenticateBearer, type Refuse } from "@/lib/bearer-auth";
import { PROJECT_STATUSES, statusReport } from "@/lib/project-list";
import type { ProjectStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const refuse: Refuse = (status, message, headers = {}) =>
  Response.json({ error: message }, { status, headers: { ...NO_STORE, ...headers } });

const isStatus = (s: string): s is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(s);

/**
 * GET /api/status: every project with its status, the counts per status, and what to do across
 * them (the To do list of the overview page), for start pages and dashboards. The projects have
 * the same fields as list_projects over MCP. Bearer: an MCP token; a read-only one
 * is enough. Filters: `label` (repeatable or comma-separated; all must match), `status`, `q`.
 * Excluded from proxy.ts: callers authenticate with the token, not a session cookie.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request, refuse);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const rawStatus = params.get("status");
  const status = rawStatus ? (isStatus(rawStatus) ? rawStatus : null) : undefined;
  if (status === null) return refuse(400, `Unknown status; use one of ${PROJECT_STATUSES.join(", ")}.`);
  const labels = params
    .getAll("label")
    .flatMap((l) => l.split(","))
    .map((l) => l.trim())
    .filter(Boolean);
  const query = params.get("q")?.slice(0, 100) || undefined;

  try {
    const report = await statusReport({ labels, status, query });
    return Response.json({ generatedAt: new Date().toISOString(), ...report }, { headers: NO_STORE });
  } catch (err) {
    console.error("[status] could not list projects", err);
    return refuse(503, "Observator could not read its data; try again later.");
  }
}
