import { TZDate } from "@date-fns/tz";
import { addDays, differenceInMinutes, format, isAfter, isBefore } from "date-fns";

/**
 * Timezone-aware date helpers for the booking engine.
 *
 * Rules this module enforces:
 *   * Instants crossing a boundary (database, API, Redis) are always UTC `Date`.
 *   * Working hours are stored as "minutes from local midnight", never as an
 *     absolute time — that is the only representation that stays correct across
 *     a DST transition, where a doctor's 09:00 clinic is still 09:00 wall-clock
 *     even though the UTC offset moved.
 */

export const MINUTES_PER_DAY = 1_440;

export interface LocalDateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Splits a UTC instant into calendar parts as seen in `timezone`. */
export function toLocalParts(instant: Date, timezone: string): LocalDateParts {
  const zoned = new TZDate(instant, timezone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
  };
}

/**
 * Builds the UTC instant for a wall-clock time in `timezone`.
 * `minutesFromMidnight` may exceed 1440 to express a session that runs past
 * midnight; the surplus rolls into the following day.
 */
export function localMinutesToUtc(
  date: LocalDateParts,
  minutesFromMidnight: number,
  timezone: string,
): Date {
  const dayOffset = Math.floor(minutesFromMidnight / MINUTES_PER_DAY);
  const withinDay = minutesFromMidnight - dayOffset * MINUTES_PER_DAY;
  const hours = Math.floor(withinDay / 60);
  const minutes = withinDay % 60;

  const zoned = new TZDate(
    date.year,
    date.month - 1,
    date.day + dayOffset,
    hours,
    minutes,
    0,
    0,
    timezone,
  );

  return new Date(zoned.getTime());
}

/** Minutes elapsed since local midnight in `timezone`. */
export function utcToLocalMinutes(instant: Date, timezone: string): number {
  const zoned = new TZDate(instant, timezone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

/** Day of week in `timezone`, 0 = Sunday .. 6 = Saturday. */
export function localDayOfWeek(instant: Date, timezone: string): number {
  return new TZDate(instant, timezone).getDay();
}

/** The UTC instant of local midnight for the day containing `instant`. */
export function startOfLocalDay(instant: Date, timezone: string): Date {
  return localMinutesToUtc(toLocalParts(instant, timezone), 0, timezone);
}

/** A stable `YYYY-MM-DD` key for the local calendar day. */
export function localDateKey(instant: Date, timezone: string): string {
  const { year, month, day } = toLocalParts(instant, timezone);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Midnight UTC for a local calendar day. `AvailabilityException.date` is stored
 * this way so a day can be matched by equality without timezone ambiguity.
 */
export function localDayToUtcMidnight(date: LocalDateParts): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0));
}

export function formatInTimezone(instant: Date, timezone: string, pattern = "PPp"): string {
  return format(new TZDate(instant, timezone), pattern);
}

/** Inclusive list of local calendar days spanned by a range. */
export function eachLocalDay(from: Date, to: Date, timezone: string): LocalDateParts[] {
  const days: LocalDateParts[] = [];
  let cursor = startOfLocalDay(from, timezone);
  const limit = startOfLocalDay(to, timezone);

  // Guard against a pathological range producing an unbounded loop.
  let iterations = 0;
  while (!isAfter(cursor, limit) && iterations < 1_000) {
    days.push(toLocalParts(cursor, timezone));
    cursor = startOfLocalDay(addDays(cursor, 1), timezone);
    iterations += 1;
  }

  return days;
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  // Touching endpoints do not overlap: a 09:00-09:30 slot and a 09:30-10:00
  // slot are adjacent, not conflicting.
  return isBefore(aStart, bEnd) && isBefore(bStart, aEnd);
}

export function minutesUntil(instant: Date, now: Date = new Date()): number {
  return differenceInMinutes(instant, now);
}

/** Validates an IANA timezone identifier against the host's ICU database. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
