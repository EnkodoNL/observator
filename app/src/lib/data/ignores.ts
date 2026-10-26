// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { reevaluate } from "@/lib/issues/reevaluate";
import { adminPb, toPbDate } from "@/lib/pb/admin";
import type { IgnoreRecord } from "@/lib/pb/types";

export const ignoreSchema = z.object({
  projectId: z.string().min(1),
  scope: z.enum(["project", "all"]),
  match: z.enum(["advisory", "package"]),
  osvId: z.string().max(128),
  pkg: z.string().max(214),
  reason: z.string().trim().min(3, "Say why, for whoever looks at this later").max(1000),
  expiresAt: z.union([z.literal(""), z.iso.date("Pick a date")]),
});

export type IgnoreInput = z.infer<typeof ignoreSchema>;

/** Ignores an advisory or a package, for one project or all, and re-evaluates right away. */
export async function createIgnore(input: IgnoreInput, userId: string): Promise<string> {
  const pb = await adminPb();
  const record = await pb.collection("ignores").create<IgnoreRecord>({
    project: input.scope === "project" ? input.projectId : "",
    osvId: input.match === "advisory" ? input.osvId : "",
    package: input.match === "package" ? input.pkg : "",
    reason: input.reason,
    expiresAt: input.expiresAt ? `${input.expiresAt} 23:59:59.000Z` : "",
    createdBy: userId,
  });
  await reevaluate(input.scope === "project" ? input.projectId : null);
  return record.id;
}

/**
 * Ends an ignore now. The record stays, expired, as a trace of who ignored what and why;
 * the advisory comes back as open, with a notification.
 */
export async function expireIgnore(id: string): Promise<IgnoreRecord> {
  const pb = await adminPb();
  const ignore = await pb.collection("ignores").getOne<IgnoreRecord>(id);
  const updated = await pb
    .collection("ignores")
    .update<IgnoreRecord>(ignore.id, { expiresAt: toPbDate(new Date()) });
  await reevaluate(ignore.project || null);
  return updated;
}

export async function deleteIgnore(id: string): Promise<void> {
  const pb = await adminPb();
  const ignore = await pb.collection("ignores").getOne<IgnoreRecord>(id);
  await pb.collection("ignores").delete(ignore.id);
  await reevaluate(ignore.project || null);
}
