// SPDX-License-Identifier: FSL-1.1-ALv2

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  hour: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localTime(date: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS.indexOf(parts.weekday),
    hour: Number(parts.hour),
  };
}

/** ISO 8601 week of a calendar date, e.g. "2026-W43". */
export function isoWeek({ year, month, day }: Pick<LocalTime, "year" | "month" | "day">): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Due once per ISO week, from the configured weekday and hour onwards, so a server that was
 * down at the scheduled moment still sends it later that week.
 */
export function digestDue(
  now: Date,
  schedule: { digestDay: number; digestHour: number; timezone: string },
  lastWeek: string | null,
): { due: boolean; week: string } {
  const local = localTime(now, schedule.timezone);
  const week = isoWeek(local);
  const mondayFirst = (d: number) => (d + 6) % 7;
  const today = mondayFirst(local.weekday);
  const target = mondayFirst(schedule.digestDay);
  const reached = today > target || (today === target && local.hour >= schedule.digestHour);
  return { due: reached && lastWeek !== week, week };
}
