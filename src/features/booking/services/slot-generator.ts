import type { ConsultationMode } from "@/generated/prisma/enums";
import {
  MINUTES_PER_DAY,
  eachLocalDay,
  localDayToUtcMidnight,
  localMinutesToUtc,
  type LocalDateParts,
} from "@/lib/utils/datetime";

/**
 * Availability expansion.
 *
 * Turns a doctor's recurring weekly rules plus their one-off exceptions into
 * concrete bookable slots. This is a pure function of its inputs — no database,
 * no clock beyond what the caller passes — which is what makes the DST and
 * conflict behaviour testable.
 *
 * Precedence, highest first:
 *   1. Vacation window        — blocks the day outright
 *   2. Exception (unavailable) — blocks the day (a holiday)
 *   3. Exception (available)   — replaces the day's rules (an extra clinic)
 *   4. Recurring weekly rules
 */

export interface AvailabilityRuleInput {
  id: string;
  clinicId: string | null;
  mode: ConsultationMode;
  /** 0 = Sunday .. 6 = Saturday, evaluated in the doctor's timezone. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  slotDurationMinutes: number;
  breakStartMinute: number | null;
  breakEndMinute: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
}

export interface AvailabilityExceptionInput {
  /** Midnight UTC for the local calendar day — see `localDayToUtcMidnight`. */
  date: Date;
  isAvailable: boolean;
  startMinute: number | null;
  endMinute: number | null;
}

export interface GenerateSlotsInput {
  doctorId: string;
  timezone: string;
  rules: AvailabilityRuleInput[];
  exceptions: AvailabilityExceptionInput[];
  /** Window to generate over, as UTC instants. */
  from: Date;
  to: Date;
  bufferMinutes: number;
  currency: string;
  /** Fee per mode, in minor units. */
  feeByMode: Partial<Record<ConsultationMode, number>>;
  vacation?: { enabled: boolean; startsAt: Date | null; endsAt: Date | null };
  /** Slots starting sooner than this many minutes from `now` are skipped. */
  minLeadMinutes?: number;
  now?: Date;
}

export interface GeneratedSlot {
  doctorId: string;
  clinicId: string | null;
  mode: ConsultationMode;
  startsAt: Date;
  endsAt: Date;
  priceMinor: number;
  currency: string;
}

function isWithinVacation(day: Date, vacation: GenerateSlotsInput["vacation"]): boolean {
  if (!vacation?.enabled) return false;
  const { startsAt, endsAt } = vacation;
  if (startsAt && day < startsAt) return false;
  if (endsAt && day > endsAt) return false;
  return true;
}

function ruleAppliesOn(rule: AvailabilityRuleInput, dayStartUtc: Date): boolean {
  if (!rule.isActive) return false;
  if (dayStartUtc < rule.effectiveFrom) return false;
  if (rule.effectiveTo && dayStartUtc > rule.effectiveTo) return false;
  return true;
}

/** True when [start,end) intersects the rule's unpaid break. */
function overlapsBreak(rule: AvailabilityRuleInput, start: number, end: number): boolean {
  const { breakStartMinute, breakEndMinute } = rule;
  if (breakStartMinute === null || breakEndMinute === null) return false;
  return start < breakEndMinute && breakStartMinute < end;
}

export function generateSlots(input: GenerateSlotsInput): GeneratedSlot[] {
  const {
    doctorId,
    timezone,
    rules,
    exceptions,
    from,
    to,
    bufferMinutes,
    currency,
    feeByMode,
    vacation,
    minLeadMinutes = 0,
    now = new Date(),
  } = input;

  if (from >= to) return [];

  const earliestStart = new Date(now.getTime() + minLeadMinutes * 60_000);

  // Index exceptions by their UTC-midnight key for O(1) day lookup.
  const exceptionByDay = new Map<number, AvailabilityExceptionInput>();
  for (const exception of exceptions) {
    exceptionByDay.set(exception.date.getTime(), exception);
  }

  const slots: GeneratedSlot[] = [];

  for (const day of eachLocalDay(from, to, timezone)) {
    const dayStartUtc = localMinutesToUtc(day, 0, timezone);
    if (isWithinVacation(dayStartUtc, vacation)) continue;

    const exception = exceptionByDay.get(localDayToUtcMidnight(day).getTime());
    if (exception && !exception.isAvailable) continue;

    // Day-of-week must come from the local calendar date, not from the UTC
    // instant, or a clinic near midnight lands on the wrong weekday.
    const localDow = localDayOfWeekFromParts(day);

    const applicable = rules.filter(
      (rule) => rule.dayOfWeek === localDow && ruleAppliesOn(rule, dayStartUtc),
    );

    // An "extra session" exception replaces the day's rules but must still
    // borrow a mode/clinic/duration, so it is applied as a window override.
    const windows =
      exception?.isAvailable && exception.startMinute !== null && exception.endMinute !== null
        ? (applicable.length > 0 ? applicable : rules.filter((rule) => rule.isActive).slice(0, 1)).map(
            (rule) => ({
              ...rule,
              startMinute: exception.startMinute as number,
              endMinute: exception.endMinute as number,
              breakStartMinute: null,
              breakEndMinute: null,
            }),
          )
        : applicable;

    for (const rule of windows) {
      const step = rule.slotDurationMinutes + bufferMinutes;
      if (step <= 0) continue;

      const priceMinor = feeByMode[rule.mode];
      if (priceMinor === undefined) continue;

      const end = Math.min(rule.endMinute, MINUTES_PER_DAY * 2);

      for (let start = rule.startMinute; start + rule.slotDurationMinutes <= end; start += step) {
        const slotEnd = start + rule.slotDurationMinutes;
        if (overlapsBreak(rule, start, slotEnd)) continue;

        const startsAt = localMinutesToUtc(day, start, timezone);
        const endsAt = localMinutesToUtc(day, slotEnd, timezone);

        if (startsAt < from || startsAt > to) continue;
        if (startsAt < earliestStart) continue;

        slots.push({
          doctorId,
          clinicId: rule.clinicId,
          mode: rule.mode,
          startsAt,
          endsAt,
          priceMinor,
          currency,
        });
      }
    }
  }

  return dedupe(slots);
}

/**
 * The database enforces uniqueness on (doctorId, startsAt, mode). Two rules can
 * legitimately overlap — a clinic session and a video session at the same hour —
 * so collisions are resolved here rather than surfacing as a constraint error.
 */
function dedupe(slots: GeneratedSlot[]): GeneratedSlot[] {
  const seen = new Map<string, GeneratedSlot>();
  for (const slot of slots) {
    const key = `${slot.doctorId}|${slot.startsAt.getTime()}|${slot.mode}`;
    if (!seen.has(key)) seen.set(key, slot);
  }
  return [...seen.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Day of week for a local calendar date, independent of any timezone shift. */
function localDayOfWeekFromParts(day: LocalDateParts): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
}
