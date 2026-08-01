import { describe, expect, it } from "vitest";

import {
  generateSlots,
  type AvailabilityRuleInput,
} from "@/features/booking/services/slot-generator";
import { localDayToUtcMidnight } from "@/lib/utils/datetime";

const TZ = "Asia/Karachi";

function rule(overrides: Partial<AvailabilityRuleInput> = {}): AvailabilityRuleInput {
  return {
    id: "rule_1",
    clinicId: "clinic_1",
    mode: "IN_PERSON",
    dayOfWeek: 1, // Monday
    startMinute: 9 * 60,
    endMinute: 12 * 60,
    slotDurationMinutes: 30,
    breakStartMinute: null,
    breakEndMinute: null,
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
    effectiveTo: null,
    isActive: true,
    ...overrides,
  };
}

// Monday 3 August 2026, Karachi.
const MONDAY_START = new Date("2026-08-03T00:00:00+05:00");
const MONDAY_END = new Date("2026-08-03T23:59:00+05:00");

const base = {
  doctorId: "doctor_1",
  timezone: TZ,
  from: MONDAY_START,
  to: MONDAY_END,
  bufferMinutes: 0,
  currency: "PKR",
  feeByMode: { IN_PERSON: 100_000 },
  now: new Date("2026-07-01T00:00:00Z"),
};

describe("slot generation", () => {
  it("divides the working window into whole slots", () => {
    const slots = generateSlots({ ...base, rules: [rule()], exceptions: [] });

    expect(slots).toHaveLength(6);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(slots.at(-1)?.startsAt.toISOString()).toBe("2026-08-03T06:30:00.000Z");
  });

  it("never emits a slot that would overrun the window", () => {
    // 09:00-12:00 with 50-minute slots fits three, not three-and-a-bit.
    const slots = generateSlots({
      ...base,
      rules: [rule({ slotDurationMinutes: 50 })],
      exceptions: [],
    });

    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.endsAt.getTime()).toBeLessThanOrEqual(
        new Date("2026-08-03T07:00:00.000Z").getTime(),
      );
    }
  });

  it("applies the inter-appointment buffer", () => {
    const slots = generateSlots({ ...base, rules: [rule()], exceptions: [], bufferMinutes: 10 });
    expect(slots).toHaveLength(4);
  });

  it("skips slots that collide with the doctor's break", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule({ breakStartMinute: 10 * 60, breakEndMinute: 10 * 60 + 30 })],
      exceptions: [],
    });

    const starts = slots.map((slot) => slot.startsAt.toISOString());
    expect(starts).not.toContain("2026-08-03T05:00:00.000Z");
    expect(slots).toHaveLength(5);
  });

  it("produces nothing on a day the doctor does not work", () => {
    const tuesday = generateSlots({
      ...base,
      rules: [rule()],
      exceptions: [],
      from: new Date("2026-08-04T00:00:00+05:00"),
      to: new Date("2026-08-04T23:59:00+05:00"),
    });

    expect(tuesday).toHaveLength(0);
  });

  it("blocks the whole day for a holiday exception", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule()],
      exceptions: [
        {
          date: localDayToUtcMidnight({ year: 2026, month: 8, day: 3 }),
          isAvailable: false,
          startMinute: null,
          endMinute: null,
        },
      ],
    });

    expect(slots).toHaveLength(0);
  });

  it("lets an availability exception replace the usual hours", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule()],
      exceptions: [
        {
          date: localDayToUtcMidnight({ year: 2026, month: 8, day: 3 }),
          isAvailable: true,
          startMinute: 14 * 60,
          endMinute: 15 * 60,
        },
      ],
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-08-03T09:00:00.000Z");
  });

  it("suppresses everything while the doctor is on vacation", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule()],
      exceptions: [],
      vacation: {
        enabled: true,
        startsAt: new Date("2026-08-01T00:00:00Z"),
        endsAt: new Date("2026-08-10T00:00:00Z"),
      },
    });

    expect(slots).toHaveLength(0);
  });

  it("honours the minimum booking lead time", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule()],
      exceptions: [],
      now: new Date("2026-08-03T04:00:00Z"),
      minLeadMinutes: 120,
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-08-03T06:00:00.000Z");
  });

  it("ignores rules that are inactive or out of their effective range", () => {
    expect(
      generateSlots({ ...base, rules: [rule({ isActive: false })], exceptions: [] }),
    ).toHaveLength(0);

    expect(
      generateSlots({
        ...base,
        rules: [rule({ effectiveTo: new Date("2026-01-01T00:00:00Z") })],
        exceptions: [],
      }),
    ).toHaveLength(0);
  });

  it("allows two consultation modes at the same instant without collision", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule(), rule({ id: "rule_2", mode: "VIDEO", clinicId: null })],
      exceptions: [],
      feeByMode: { IN_PERSON: 100_000, VIDEO: 80_000 },
    });

    expect(slots).toHaveLength(12);

    const atNine = slots.filter(
      (slot) => slot.startsAt.toISOString() === "2026-08-03T04:00:00.000Z",
    );
    expect(atNine.map((slot) => slot.mode).sort()).toEqual(["IN_PERSON", "VIDEO"]);
  });

  it("deduplicates identical (doctor, instant, mode) triples", () => {
    // Two overlapping rules for the same mode must not violate the DB's
    // unique index once persisted.
    const slots = generateSlots({
      ...base,
      rules: [rule(), rule({ id: "duplicate" })],
      exceptions: [],
    });

    const keys = slots.map((slot) => `${slot.startsAt.getTime()}|${slot.mode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("skips a mode that has no fee configured", () => {
    const slots = generateSlots({
      ...base,
      rules: [rule({ mode: "PHONE" })],
      exceptions: [],
      feeByMode: { IN_PERSON: 100_000 },
    });

    expect(slots).toHaveLength(0);
  });

  describe("daylight saving", () => {
    it("keeps wall-clock start time across a spring-forward boundary", () => {
      // 8 March 2026 is when US clocks move EST -> EDT.
      const slots = generateSlots({
        doctorId: "doctor_ny",
        timezone: "America/New_York",
        rules: [rule({ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 11 * 60 })],
        exceptions: [],
        bufferMinutes: 0,
        currency: "USD",
        feeByMode: { IN_PERSON: 5_000 },
        from: new Date("2026-03-08T00:00:00-05:00"),
        to: new Date("2026-03-08T23:59:00-04:00"),
        now: new Date("2026-01-01T00:00:00Z"),
      });

      // 09:00 EDT is 13:00Z. If the offset were taken from the previous day it
      // would wrongly compute 14:00Z.
      expect(slots[0]?.startsAt.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    });

    it("keeps wall-clock start time across a fall-back boundary", () => {
      const slots = generateSlots({
        doctorId: "doctor_ny",
        timezone: "America/New_York",
        rules: [rule({ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 10 * 60 })],
        exceptions: [],
        bufferMinutes: 0,
        currency: "USD",
        feeByMode: { IN_PERSON: 5_000 },
        from: new Date("2026-11-01T00:00:00-04:00"),
        to: new Date("2026-11-01T23:59:00-05:00"),
        now: new Date("2026-01-01T00:00:00Z"),
      });

      // Back on EST (-5), so 09:00 local is 14:00Z.
      expect(slots[0]?.startsAt.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    });
  });
});
