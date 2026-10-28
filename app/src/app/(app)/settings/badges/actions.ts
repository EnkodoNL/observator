// SPDX-License-Identifier: FSL-1.1-ALv2
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { rotateAppBadge, rotateProjectBadge } from "@/lib/badges";

export interface BadgeTarget {
  kind: "app" | "project";
  /** The app id, or the project's record id. */
  id: string;
}

const targetSchema = z.object({ kind: z.enum(["app", "project"]), id: z.string().min(1).max(100) });

export async function rotateBadgeAction(target: BadgeTarget): Promise<void> {
  await requireUser();
  const { kind, id } = targetSchema.parse(target);
  if (kind === "app") await rotateAppBadge(id);
  else await rotateProjectBadge(id);
  revalidatePath("/", "layout");
}
