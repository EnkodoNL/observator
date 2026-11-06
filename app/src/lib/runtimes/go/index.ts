// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { RuntimeProvider } from "../types";
import { goEvaluator } from "./evaluate";
import { getGoData, refreshGoData } from "./releases";

/**
 * Go: releases from go.dev, and security from OSV's advisories for the standard library, since
 * Go marks no release as a security release. The runtime is compiled into the program, so the
 * fix is a newer golang image in the stage that builds it.
 */
export const go: RuntimeProvider = {
  name: "go",
  label: "Go",
  refresh: async () => {
    await refreshGoData();
  },
  evaluator: async () => {
    const data = await getGoData();
    return data ? goEvaluator(data) : null;
  },
};
