import { createHash } from "node:crypto";

import {
  DEMO_SCHEDULES,
  findDemoDoctor,
} from "@/features/doctors/repositories/in-memory-doctor.repository";
import type { ConsultationMode } from "@/generated/prisma/enums";
import { env } from "@/lib/config/env";
import { localDateKey } from "@/lib/utils/datetime";

import type { AvailabilityQuery, DayAvailability, DoctorAvailability, SlotView } from "../domain/slot";
import { generateSlots, type AvailabilityRuleInput } from "../services/slot-generator";
import type { SlotRepository } from "./slot.repository";

/**
 * In-memory availability, expanded from the demo schedules by the same
 * generator the Postgres path seeds with. Slot ids are a deterministic hash of
 * (doctor, instant, mode) so a slot keeps its identity across requests and can
 * be resolved by `findById` without any stored state.
 */

const TZ = "Asia/Karachi";

function slotId(doctorId: string, startsAt: Date, mode: ConsultationMode): string {
  return createHash("sha1")
    .update(`${doctorId}|${startsAt.getTime()}|${mode}`)
    .digest("hex")
    .slice(0, 24);
}

export class InMemorySlotRepository implements SlotRepository {
  async getAvailability(query: AvailabilityQuery): Promise<DoctorAvailability> {
    const doctor = findDemoDoctor(query.doctorId);
    const schedule = DEMO_SCHEDULES[query.doctorId];

    if (!doctor || !schedule || !doctor.isAcceptingPatients) {
      return { timezone: TZ, days: [], totalOpenSlots: 0 };
    }

    const now = new Date();
    const to = new Date(now.getTime() + query.days * 24 * 60 * 60 * 1000);

    const modes = query.mode ? [query.mode] : doctor.modes;
    const feeByMode: Partial<Record<ConsultationMode, number>> = {};
    for (const mode of modes) {
      const fee = doctor.feesByMode[mode];
      if (fee !== undefined) feeByMode[mode] = fee;
    }

    const rules: AvailabilityRuleInput[] = [];
    for (const dayOfWeek of schedule.workDays) {
      for (const mode of modes) {
        if (feeByMode[mode] === undefined) continue;
        rules.push({
          id: `${query.doctorId}-${dayOfWeek}-${mode}`,
          clinicId: mode === "IN_PERSON" ? `${query.doctorId}-clinic` : null,
          mode,
          dayOfWeek,
          startMinute: schedule.startMinute,
          endMinute: schedule.endMinute,
          slotDurationMinutes: doctor.consultationDurationMinutes,
          breakStartMinute: schedule.breakStartMinute,
          breakEndMinute: schedule.breakEndMinute,
          effectiveFrom: new Date(0),
          effectiveTo: null,
          isActive: true,
        });
      }
    }

    const generated = generateSlots({
      doctorId: query.doctorId,
      timezone: TZ,
      rules,
      exceptions: [],
      from: now,
      to,
      bufferMinutes: 5,
      currency: doctor.currency,
      feeByMode,
      minLeadMinutes: env.BOOKING_MIN_LEAD_MINUTES,
      now,
    });

    return groupByDay(
      generated.map((slot) => ({
        id: slotId(slot.doctorId, slot.startsAt, slot.mode),
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        mode: slot.mode,
        priceMinor: slot.priceMinor,
        currency: slot.currency,
        clinicId: slot.clinicId,
      })),
      TZ,
      query.days,
      now,
    );
  }

  async findById(id: string): Promise<SlotView | null> {
    // Ids are derived, so resolving one means re-expanding the demo calendar
    // and matching. Bounded to the standard horizon, this stays cheap.
    for (const doctorId of Object.keys(DEMO_SCHEDULES)) {
      const availability = await this.getAvailability({ doctorId, days: 30 });
      for (const day of availability.days) {
        const match = day.slots.find((slot) => slot.id === id);
        if (match) return match;
      }
    }
    return null;
  }
}

/** Buckets slots into consecutive local days, including days with none. */
export function groupByDay(
  slots: SlotView[],
  timezone: string,
  days: number,
  now: Date,
): DoctorAvailability {
  const buckets = new Map<string, SlotView[]>();
  for (const slot of slots) {
    const key = localDateKey(new Date(slot.startsAt), timezone);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(slot);
    else buckets.set(key, [slot]);
  }

  const todayKey = localDateKey(now, timezone);
  const result: DayAvailability[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const cursor = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const key = localDateKey(cursor, timezone);
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" });
    const dayFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
    });

    result.push({
      dateKey: key,
      weekdayLabel: offset === 0 ? "Today" : formatter.format(cursor),
      dayLabel: dayFormatter.format(cursor),
      isToday: key === todayKey,
      slots: (buckets.get(key) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    });
  }

  return {
    timezone,
    days: result,
    totalOpenSlots: slots.length,
  };
}
