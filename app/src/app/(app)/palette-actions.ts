// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { adminPb } from "@/lib/pb/admin";

/** Package names matching a query, with how many projects use them, for the command palette. */
export async function searchPackageNamesAction(query: string): Promise<{ name: string; projects: number }[]> {
  await requireUser();
  const q = z.string().trim().max(214).parse(query).toLowerCase();
  if (q.length < 2) return [];
  const pb = await adminPb();
  const rows = await pb.collection("components").getList<{ name: string; project: string }>(1, 500, {
    filter: pb.filter("name ~ {:q}", { q }),
    fields: "name,project",
  });
  const counts = new Map<string, Set<string>>();
  for (const r of rows.items) counts.set(r.name, (counts.get(r.name) ?? new Set()).add(r.project));
  const rank = (name: string) => (name === q ? 0 : name.startsWith(q) ? 1 : 2);
  return [...counts]
    .map(([name, set]) => ({ name, projects: set.size }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.projects - a.projects || a.name.localeCompare(b.name))
    .slice(0, 8);
}
