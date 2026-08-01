import type { ConsultationMode } from "@/generated/prisma/enums";

/**
 * Availability read models.
 *
 * Instants cross to the client as ISO strings — a `Date` cannot be serialised
 * across the React Server Component boundary — and are rendered in the
 * doctor's timezone, which travels alongside them.
 */

export interface SlotView {
  id: string;
  startsAt: string;
  endsAt: string;
  mode: ConsultationMode;
  priceMinor: number;
  currency: string;
  clinicId: string | null;
}

export interface DayAvailability {
  /** `YYYY-MM-DD` in the doctor's local timezone. */
  dateKey: string;
  weekdayLabel: string;
  dayLabel: string;
  isToday: boolean;
  slots: SlotView[];
}

export interface AvailabilityQuery {
  doctorId: string;
  /** Number of consecutive local days to return, starting today. */
  days: number;
  mode?: ConsultationMode;
}

export interface DoctorAvailability {
  timezone: string;
  days: DayAvailability[];
  totalOpenSlots: number;
}
