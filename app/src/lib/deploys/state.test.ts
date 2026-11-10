// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { deployState, freshDeployState, parseDeployments, type CoolifyDeployment } from "./state";

const LAST_REPORT = new Date("2026-10-27T17:45:00Z");

const deploy = (
  uuid: string,
  createdAt: string,
  over: Partial<CoolifyDeployment> = {},
): CoolifyDeployment => ({
  uuid,
  status: "finished",
  restartOnly: false,
  commit: `commit-${uuid}`,
  createdAt,
  finishedAt: new Date(Date.parse(createdAt) + 5 * 60_000).toISOString(),
  ...over,
});

// The deploy whose build reported at LAST_REPORT.
const reported = deploy("a", "2026-10-27T17:40:00Z");

describe("deployState", () => {
  it("sees nothing to worry about when nothing was deployed since the report", () => {
    expect(deployState([reported], LAST_REPORT)).toEqual({
      lastDeployAt: "2026-10-27T17:45:00.000Z",
      unreported: null,
    });
  });

  it("ignores restarts, failed and running deploys", () => {
    const later = [
      deploy("r", "2026-11-05T10:00:00Z", { restartOnly: true }),
      deploy("f", "2026-11-05T11:00:00Z", { status: "failed" }),
      deploy("q", "2026-11-05T12:00:00Z", { status: "in_progress" }),
    ];
    expect(deployState([reported, ...later], LAST_REPORT).unreported).toBeNull();
  });

  it("flags the newest deploy since the report that did not report", () => {
    const silent = [deploy("b", "2026-11-03T09:00:00Z"), deploy("c", "2026-11-05T09:00:00Z")];
    expect(deployState([reported, ...silent], LAST_REPORT).unreported).toEqual({
      at: "2026-11-05T09:05:00.000Z",
      commit: "commit-c",
      uuid: "c",
    });
  });

  it("does not flag a compose service that was cached while another one reported", () => {
    const later = deploy("b", "2026-11-05T09:00:00Z");
    expect(
      deployState([reported, later], LAST_REPORT, [new Date("2026-11-05T09:03:00Z")]).unreported,
    ).toBeNull();
    // A sibling report from before the deploy says nothing about it.
    expect(
      deployState([reported, later], LAST_REPORT, [new Date("2026-11-01T00:00:00Z")]).unreported,
    ).not.toBeNull();
  });

  it("does not flag a redeploy of the commit that already reported: that build was cached", () => {
    const redeploy = deploy("b", "2026-11-05T09:00:00Z", { commit: reported.commit });
    expect(deployState([reported, redeploy], LAST_REPORT).unreported).toBeNull();
  });
});

describe("parseDeployments", () => {
  it("reads Coolify's answer and skips what it cannot use", () => {
    expect(
      parseDeployments({
        count: 3,
        deployments: [
          {
            deployment_uuid: "d1",
            status: "finished",
            restart_only: false,
            commit: "abc",
            created_at: "2026-11-05T09:00:00.000000Z",
            finished_at: null,
            updated_at: "2026-11-05T09:04:00.000000Z",
          },
          { deployment_uuid: "d2", status: "finished", created_at: "not a date" },
          { status: "finished", created_at: "2026-11-05T09:00:00Z" },
        ],
      }),
    ).toEqual([
      {
        uuid: "d1",
        status: "finished",
        restartOnly: false,
        commit: "abc",
        createdAt: "2026-11-05T09:00:00.000000Z",
        finishedAt: "2026-11-05T09:04:00.000000Z",
      },
    ]);
    expect(parseDeployments({ message: "Unauthenticated." })).toEqual([]);
  });
});

describe("freshDeployState", () => {
  it("uses a recent answer without an error, nothing else", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const state = { checkedAt: "2026-11-10T11:00:00Z", lastDeployAt: null, unreported: null, error: null };
    expect(freshDeployState(state, now)).toBe(state);
    expect(freshDeployState({ ...state, error: "Coolify timed out" }, now)).toBeNull();
    expect(freshDeployState({ ...state, checkedAt: "2026-11-07T11:00:00Z" }, now)).toBeNull();
    expect(freshDeployState(null, now)).toBeNull();
  });
});
