import { z } from "zod";

export const holdSlotSchema = z.object({
  slotId: z.string().min(1, "A slot must be selected."),
});

export const confirmBookingSchema = z.object({
  slotId: z.string().min(1),
  holdToken: z.string().min(1),
  reasonForVisit: z
    .string()
    .max(200, "Keep the reason under 200 characters.")
    .optional()
    .or(z.literal("")),
  patientNotes: z
    .string()
    .max(2_000, "Notes are limited to 2,000 characters.")
    .optional()
    .or(z.literal("")),
  couponCode: z
    .string()
    .max(32)
    .regex(/^[A-Za-z0-9_-]*$/, "Coupon codes contain letters, numbers, hyphens and underscores.")
    .optional()
    .or(z.literal("")),
});

export const cancelAppointmentSchema = z.object({
  appointmentId: z.string().min(1),
  reason: z.string().max(500).optional().or(z.literal("")),
});

export const rescheduleAppointmentSchema = z.object({
  appointmentId: z.string().min(1),
  newSlotId: z.string().min(1),
});

export type HoldSlotInput = z.infer<typeof holdSlotSchema>;
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
