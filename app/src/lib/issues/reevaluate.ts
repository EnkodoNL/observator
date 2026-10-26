// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { revalidatePath } from "next/cache";
import { evaluateAll, evaluateProject } from "@/lib/issues/evaluate";
import { publish } from "@/lib/notify/publish";

/** Applies ignore changes right away; lifting one can produce a notification again. */
export async function reevaluate(projectId: string | null): Promise<void> {
  const events = projectId ? await evaluateProject(projectId) : await evaluateAll();
  await publish(events);
  revalidatePath("/", "layout");
}
