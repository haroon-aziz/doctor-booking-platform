import { prisma } from "@/lib/db/prisma";

import type { AvailabilityQuery, DoctorAvailability, SlotView } from "../domain/slot";
import { groupByDay } from "./in-memory-slot.repository";
import type { SlotRepository } from "./slot.repository";

/**
 * Postgres availability. Only AVAILABLE slots in the future are returned —
 * HELD slots belong to another patient mid-checkout and BOOKED ones are gone,
 * so surfacing either would invite a booking that is guaranteed to fail.
 */
export class PrismaSlotRepository implements SlotRepository {
  async getAvailability(query: AvailabilityQuery): Promise<DoctorAvailability> {
    const doctor = await prisma.doctor.findUnique({
      where: { id: query.doctorId },
      select: { timezone: true, isAcceptingPatients: true, vacationMode: true },
    });

    const timezone = doctor?.timezone ?? "Asia/Karachi";
    if (!doctor || !doctor.isAcceptingPatients || doctor.vacationMode) {
      return { timezone, days: [], totalOpenSlots: 0 };
    }

    const now = new Date();
    const to = new Date(now.getTime() + query.days * 24 * 60 * 60 * 1000);

    const rows = await prisma.appointmentSlot.findMany({
      where: {
        doctorId: query.doctorId,
        status: "AVAILABLE",
        startsAt: { gte: now, lte: to },
        ...(query.mode ? { mode: query.mode } : {}),
      },
      orderBy: { startsAt: "asc" },
      // A wide horizon on a busy doctor can be thousands of rows; the panel
      // only ever renders a fraction of them.
      take: 500,
    });

    return groupByDay(rows.map(toSlotView), timezone, query.days, now);
  }

  async findById(slotId: string): Promise<SlotView | null> {
    const row = await prisma.appointmentSlot.findUnique({ where: { id: slotId } });
    return row ? toSlotView(row) : null;
  }
}

function toSlotView(row: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  mode: SlotView["mode"];
  priceMinor: number;
  currency: string;
  clinicId: string | null;
}): SlotView {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    mode: row.mode,
    priceMinor: row.priceMinor,
    currency: row.currency,
    clinicId: row.clinicId,
  };
}
