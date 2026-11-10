// SPDX-License-Identifier: FSL-1.1-ALv2

/** One entry of Coolify's GET /api/v1/deployments/applications/{uuid}. */
export interface CoolifyDeployment {
  uuid: string;
  status: string;
  /** A restart rebuilds nothing, so it reports nothing. */
  restartOnly: boolean;
  commit: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** What Coolify says about a project's deploys, kept per project and read by the evaluation. */
export interface DeployState {
  checkedAt: string;
  lastDeployAt: string | null;
  /** The newest deploy since the last report that should have reported and did not. */
  unreported: { at: string; commit: string | null; uuid: string } | null;
  /** Why Coolify could not be read; then the age check applies as before. */
  error: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Coolify's answer, {count, deployments: [...]}, to what Observator needs from it. */
export function parseDeployments(body: unknown): CoolifyDeployment[] {
  const list = (body as { deployments?: unknown } | null)?.deployments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d: Record<string, unknown>) => {
    const uuid = text(d?.deployment_uuid);
    const createdAt = text(d?.created_at);
    if (!uuid || !createdAt || Number.isNaN(Date.parse(createdAt))) return [];
    return [
      {
        uuid,
        status: text(d.status) ?? "",
        restartOnly: d.restart_only === true,
        commit: text(d.commit),
        createdAt,
        finishedAt: text(d.finished_at) ?? text(d.updated_at),
      },
    ];
  });
}

/**
 * Compares Coolify's deploys with the last report. A deploy builds the image, and the snippet
 * reports during that build, so a finished deploy that started after the last report should
 * have sent one. It did not need to when:
 * - another project on the same Coolify resource reported after it started: a compose deploy
 *   rebuilds only what changed, and the services it left alone were cached;
 * - it built the same commit as the deploy that did report: a redeploy, fully cached.
 */
export function deployState(
  deployments: CoolifyDeployment[],
  lastBuildAt: Date,
  siblingReports: Date[] = [],
): Pick<DeployState, "lastDeployAt" | "unreported"> {
  const built = deployments
    .filter((d) => d.status === "finished" && !d.restartOnly)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const lastDeployAt = built[0] ? (built[0].finishedAt ?? built[0].createdAt) : null;
  const since = built.filter((d) => Date.parse(d.createdAt) > lastBuildAt.getTime());
  const newest = since[0];
  if (!newest) return { lastDeployAt, unreported: null };

  const started = Date.parse(newest.createdAt);
  if (siblingReports.some((r) => r.getTime() > started)) return { lastDeployAt, unreported: null };
  const reported = built.find((d) => Date.parse(d.createdAt) <= lastBuildAt.getTime());
  if (newest.commit && reported?.commit === newest.commit) return { lastDeployAt, unreported: null };
  return {
    lastDeployAt,
    unreported: { at: newest.finishedAt ?? newest.createdAt, commit: newest.commit, uuid: newest.uuid },
  };
}

/** Where a project's state is kept (kv). */
export const deployStateKey = (projectId: string) => `coolify:deploys:${projectId}`;

/** A state recent enough to overrule the age check: the job runs hourly. */
export const freshDeployState = (state: DeployState | null, now: Date): DeployState | null =>
  state && !state.error && now.getTime() - Date.parse(state.checkedAt) < 2 * 24 * 3600 * 1000 ? state : null;
