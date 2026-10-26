// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { RuntimePhase, RuntimeProvider } from "../types";
import { evaluateNode, type LinePhase, PHASE_LABEL } from "./evaluate";
import { getNodeData, refreshNodeData } from "./releases";

const PHASE: Record<LinePhase, RuntimePhase> = {
  current: "current",
  "active-lts": "active",
  maintenance: "maintenance",
  eol: "eol",
  unknown: "unknown",
};

/** Node.js: releases from nodejs.org (with a security flag per release), lines from the Release WG. */
export const node: RuntimeProvider = {
  name: "node",
  label: "Node.js",
  refresh: async () => {
    await refreshNodeData();
  },
  evaluator: async () => {
    const data = await getNodeData();
    if (!data) return null;
    return (version, now) => {
      const e = evaluateNode(version, data, now);
      return {
        runtime: "node",
        label: "Node.js",
        version: e.version,
        line: String(e.major),
        phase: PHASE[e.phase],
        phaseLabel: PHASE_LABEL[e.phase],
        codename: e.codename,
        end: e.end,
        daysToEol: e.daysToEol,
        eolSoon: e.eolSoon,
        latestInLine: e.latestInLine,
        securityUpdate: e.securityUpdate,
        patchAvailable: e.patchAvailable,
        latestSupported: e.latestLts,
      };
    };
  },
};
