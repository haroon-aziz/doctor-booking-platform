"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  cancelAppointment,
  confirmBooking,
  holdSlot,
  releaseSlot,
  rescheduleAppointment,
} from "@/features/booking/services/booking.service";
import {
  cancelAppointmentSchema,
  confirmBookingSchema,
  holdSlotSchema,
  rescheduleAppointmentSchema,
} from "@/features/booking/schemas/booking.schema";
import { requirePatient, requireUser } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/actions/action-result";
import { RateLimitedError } from "@/lib/errors/app-error";
import { clientIdentifier, rateLimit } from "@/lib/rate-limit";

/**
 * Booking server actions.
 *
 * Every action re-authenticates and re-authorises. A server action is a public
 * HTTP endpoint — the fact that the only link to it sits behind a login screen
 * is not access control.
 */

async function enforceRateLimit(bucket: string, userId: string, max: number): Promise<void> {
  const identifier = clientIdentifier(await headers());
  const result = await rateLimit({
    key: `${bucket}:${userId}:${identifier}`,
    max,
    windowSeconds: 60,
    // Booking mutations fail closed: better to ask a patient to retry than to
    // let an unbounded retry loop hammer the slot table.
    failClosed: true,
  });

  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}

export interface HoldSlotActionResult {
  holdToken: string;
  expiresAt: string;
  slot: {
    id: string;
    doctorName: string;
    mode: string;
    startsAt: string;
    endsAt: string;
    priceMinor: number;
    currency: string;
  };
}

export async function holdSlotAction(
  input: unknown,
): Promise<ActionResult<HoldSlotActionResult>> {
  return runAction("holdSlot", async () => {
    const { slotId } = holdSlotSchema.parse(input);
    const { user } = await requirePatient();

    await enforceRateLimit("hold", user.id, 20);

    const result = await holdSlot({ slotId, userId: user.id });

    return {
      holdToken: result.hold.token,
      expiresAt: result.hold.expiresAt.toISOString(),
      slot: {
        id: result.slot.id,
        doctorName: result.slot.doctorName,
        mode: result.slot.mode,
        startsAt: result.slot.startsAt.toISOString(),
        endsAt: result.slot.endsAt.toISOString(),
        priceMinor: result.slot.priceMinor,
        currency: result.slot.currency,
      },
    };
  });
}

export async function releaseSlotAction(
  slotId: string,
  holdToken: string,
): Promise<ActionResult<{ released: true }>> {
  return runAction("releaseSlot", async () => {
    const user = await requireUser();
    await releaseSlot(slotId, user.id, holdToken);
    return { released: true as const };
  });
}

export interface ConfirmBookingActionResult {
  appointmentId: string;
  referenceCode: string;
  status: string;
  requiresPaymentAction: boolean;
  redirectUrl?: string;
}

export async function confirmBookingAction(
  input: unknown,
): Promise<ActionResult<ConfirmBookingActionResult>> {
  return runAction("confirmBooking", async () => {
    const parsed = confirmBookingSchema.parse(input);
    const { user, patientId } = await requirePatient();

    await enforceRateLimit("confirm", user.id, 10);

    const result = await confirmBooking({
      slotId: parsed.slotId,
      holdToken: parsed.holdToken,
      userId: user.id,
      patientId,
      reasonForVisit: parsed.reasonForVisit || undefined,
      patientNotes: parsed.patientNotes || undefined,
      couponCode: parsed.couponCode || undefined,
    });

    revalidatePath("/appointments");

    return {
      appointmentId: result.appointmentId,
      referenceCode: result.referenceCode,
      status: result.status,
      requiresPaymentAction: result.requiresPaymentAction,
      redirectUrl: result.redirectUrl,
    };
  });
}

export async function cancelAppointmentAction(
  input: unknown,
): Promise<ActionResult<{ refunded: boolean }>> {
  return runAction("cancelAppointment", async () => {
    const parsed = cancelAppointmentSchema.parse(input);
    const user = await requireUser();

    await enforceRateLimit("cancel", user.id, 10);

    const result = await cancelAppointment({
      appointmentId: parsed.appointmentId,
      actorUserId: user.id,
      actorRole: user.role,
      reason: parsed.reason || undefined,
    });

    revalidatePath("/appointments");
    revalidatePath("/doctor/appointments");

    return result;
  });
}

export async function rescheduleAppointmentAction(
  input: unknown,
): Promise<ActionResult<{ appointmentId: string; referenceCode: string }>> {
  return runAction("rescheduleAppointment", async () => {
    const parsed = rescheduleAppointmentSchema.parse(input);
    const { user, patientId } = await requirePatient();

    await enforceRateLimit("reschedule", user.id, 10);

    const result = await rescheduleAppointment({
      appointmentId: parsed.appointmentId,
      newSlotId: parsed.newSlotId,
      userId: user.id,
      patientId,
    });

    revalidatePath("/appointments");

    return result;
  });
}
