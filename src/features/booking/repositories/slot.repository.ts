import type { AvailabilityQuery, DoctorAvailability, SlotView } from "../domain/slot";

/**
 * Availability data access. Implemented against Postgres in production and
 * in-memory (generated on the fly by the shared slot generator) for design
 * review and tests.
 */
export interface SlotRepository {
  getAvailability(query: AvailabilityQuery): Promise<DoctorAvailability>;
  findById(slotId: string): Promise<SlotView | null>;
}
