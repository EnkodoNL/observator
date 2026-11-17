// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import type { RuntimeProvider } from "../types";
import { eolEvaluator } from "./evaluate";
import { EOL_PRODUCTS } from "./products";
import { getEolData, refreshEolData } from "./releases";

/**
 * Servers and databases (MariaDB, PostgreSQL, Redis, ...): their release lines, end of life and
 * newest patch from endoflife.date. One provider per product, as Node and Go have their own.
 */
export const eolProviders: Record<string, RuntimeProvider> = Object.fromEntries(
  Object.entries(EOL_PRODUCTS).map(([name, label]) => [
    name,
    {
      name,
      label,
      refresh: async () => {
        await refreshEolData(name);
      },
      evaluator: async () => {
        const data = await getEolData(name);
        return data ? eolEvaluator(name, label, data) : null;
      },
    } satisfies RuntimeProvider,
  ]),
);
