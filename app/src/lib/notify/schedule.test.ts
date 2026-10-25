// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from "vitest";
import { digestDue, isoWeek, localTime } from "./schedule";

const monday9 = { digestDay: 1, digestHour: 9, timezone: "Europe/Amsterdam" };

describe("isoWeek", () => {
  it.each([
    [{ year: 2026, month: 10, day: 26 }, "2026-W44"],
    [{ year: 2026, month: 1, day: 1 }, "2026-W01"],
    [{ year: 2027, month: 1, day: 1 }, "2026-W53"],
    [{ year: 2024, month: 12, day: 30 }, "2025-W01"],
  ])("%o is %s", (date, week) => expect(isoWeek(date)).toBe(week));
});

describe("digestDue", () => {
  it("waits for Monday 09:00 local time", () => {
    // 07:30 UTC on Monday 26 Oct 2026 is 08:30 in Amsterdam (CET after the DST change).
    expect(digestDue(new Date("2026-10-26T07:30:00Z"), monday9, null).due).toBe(false);
    expect(digestDue(new Date("2026-10-26T08:00:00Z"), monday9, null)).toEqual({
      due: true,
      week: "2026-W44",
    });
  });

  it("sends once per week and catches up later in the week", () => {
    expect(digestDue(new Date("2026-10-26T12:00:00Z"), monday9, "2026-W44").due).toBe(false);
    expect(digestDue(new Date("2026-10-29T12:00:00Z"), monday9, "2026-W43").due).toBe(true);
  });

  it("handles a Sunday schedule at the end of the ISO week", () => {
    const sunday = { digestDay: 0, digestHour: 18, timezone: "UTC" };
    expect(digestDue(new Date("2026-10-31T19:00:00Z"), sunday, null).due).toBe(false);
    expect(digestDue(new Date("2026-11-01T18:00:00Z"), sunday, null).due).toBe(true);
  });

  it("uses the configured timezone", () => {
    expect(localTime(new Date("2026-10-25T23:30:00Z"), "Asia/Tokyo")).toMatchObject({
      day: 26,
      weekday: 1,
      hour: 8,
    });
  });
});
