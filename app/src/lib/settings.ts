// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/kv";

export const settingsSchema = z.object({
  /** A project without a build for this many days counts as stale. */
  staleDays: z.coerce.number().int().min(1).max(365),
  /** Remind about issues that are still open after this many days; 0 disables reminders. */
  renotifyDays: z.coerce.number().int().min(0).max(365),
  digestEnabled: z.boolean(),
  /** 0 = Sunday ... 6 = Saturday */
  digestDay: z.coerce.number().int().min(0).max(6),
  digestHour: z.coerce.number().int().min(0).max(23),
  timezone: z.string().refine(isTimezone, "Unknown timezone"),
  /** Advisories in dev dependencies count toward status, notifications and the build gate. */
  countDevDependencies: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function defaults(): Settings {
  const tz = env().TZ;
  return {
    staleDays: 14,
    renotifyDays: 0,
    digestEnabled: true,
    digestDay: 1,
    digestHour: 9,
    timezone: isTimezone(tz) ? tz : "UTC",
    countDevDependencies: false,
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await kvGet<Partial<Settings>>("settings");
  const merged = { ...defaults(), ...(stored ?? {}) };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaults();
}

export async function saveSettings(settings: Settings): Promise<void> {
  await kvSet("settings", settingsSchema.parse(settings));
}
