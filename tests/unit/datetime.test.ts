import { describe, expect, it } from "vitest";

import {
  eachLocalDay,
  isValidTimezone,
  localDateKey,
  localDayOfWeek,
  localMinutesToUtc,
  rangesOverlap,
  startOfLocalDay,
  utcToLocalMinutes,
} from "@/lib/utils/datetime";

describe("timezone helpers", () => {
  it("converts wall-clock minutes to the correct UTC instant", () => {
    expect(
      localMinutesToUtc({ year: 2026, month: 3, day: 15 }, 9 * 60, "Asia/Karachi").toISOString(),
    ).toBe("2026-03-15T04:00:00.000Z");
  });

  it("uses the offset in force on that specific date", () => {
    // Either side of the 8 March 2026 US transition.
    expect(
      localMinutesToUtc({ year: 2026, month: 3, day: 7 }, 9 * 60, "America/New_York").toISOString(),
    ).toBe("2026-03-07T14:00:00.000Z");

    expect(
      localMinutesToUtc({ year: 2026, month: 3, day: 9 }, 9 * 60, "America/New_York").toISOString(),
    ).toBe("2026-03-09T13:00:00.000Z");
  });

  it("round-trips wall-clock minutes in several zones", () => {
    const cases = [
      ["Asia/Karachi", 2026, 7, 1, 570],
      ["America/New_York", 2026, 3, 9, 570],
      ["Europe/London", 2026, 10, 26, 615],
      ["Australia/Sydney", 2026, 4, 6, 840],
      ["Asia/Kathmandu", 2026, 6, 15, 495],
    ] as const;

    for (const [tz, year, month, day, minutes] of cases) {
      const instant = localMinutesToUtc({ year, month, day }, minutes, tz);
      expect(utcToLocalMinutes(instant, tz)).toBe(minutes);
      expect(localDateKey(instant, tz)).toBe(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
  });

  it("reads day-of-week in local time, not UTC", () => {
    // 00:30 on 1 Jan 2026 in Karachi is still 31 Dec in UTC.
    const instant = localMinutesToUtc({ year: 2026, month: 1, day: 1 }, 30, "Asia/Karachi");
    expect(localDayOfWeek(instant, "Asia/Karachi")).toBe(4); // Thursday
    expect(instant.getUTCDay()).toBe(3); // Wednesday
  });

  it("finds local midnight", () => {
    const instant = localMinutesToUtc({ year: 2026, month: 1, day: 1 }, 30, "Asia/Karachi");
    expect(startOfLocalDay(instant, "Asia/Karachi").toISOString()).toBe(
      "2025-12-31T19:00:00.000Z",
    );
  });

  it("enumerates local days inclusively", () => {
    const days = eachLocalDay(
      new Date("2026-08-03T00:00:00+05:00"),
      new Date("2026-08-06T23:00:00+05:00"),
      "Asia/Karachi",
    );
    expect(days).toHaveLength(4);
    expect(days[0]).toEqual({ year: 2026, month: 8, day: 3 });
    expect(days.at(-1)).toEqual({ year: 2026, month: 8, day: 6 });
  });

  describe("overlap", () => {
    const at = (iso: string) => new Date(iso);

    it("treats touching ranges as non-overlapping", () => {
      // 09:00-09:30 and 09:30-10:00 are adjacent appointments, not a conflict.
      expect(
        rangesOverlap(
          at("2026-08-03T09:00:00Z"),
          at("2026-08-03T09:30:00Z"),
          at("2026-08-03T09:30:00Z"),
          at("2026-08-03T10:00:00Z"),
        ),
      ).toBe(false);
    });

    it("detects a genuine overlap", () => {
      expect(
        rangesOverlap(
          at("2026-08-03T09:00:00Z"),
          at("2026-08-03T09:30:00Z"),
          at("2026-08-03T09:15:00Z"),
          at("2026-08-03T09:45:00Z"),
        ),
      ).toBe(true);
    });

    it("detects full containment", () => {
      expect(
        rangesOverlap(
          at("2026-08-03T09:00:00Z"),
          at("2026-08-03T11:00:00Z"),
          at("2026-08-03T09:30:00Z"),
          at("2026-08-03T10:00:00Z"),
        ),
      ).toBe(true);
    });
  });

  it("validates IANA identifiers", () => {
    expect(isValidTimezone("Asia/Karachi")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
  });
});
