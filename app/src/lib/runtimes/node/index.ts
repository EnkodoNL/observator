// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { RuntimeProvider } from "../types";
import { nodeEvaluator } from "./evaluate";
import { getNodeData, refreshNodeData } from "./releases";

/** Node.js: releases from nodejs.org (with a security flag per release), lines from the Release WG. */
export const node: RuntimeProvider = {
  name: "node",
  label: "Node.js",
  refresh: async () => {
    await refreshNodeData();
  },
  evaluator: async () => {
    const data = await getNodeData();
    return data ? nodeEvaluator(data) : null;
  },
};
