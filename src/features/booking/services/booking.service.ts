import { getPaymentAdapter } from "@/adapters/payments";
import { getVideoAdapter } from "@/adapters/video";
import type { AppointmentStatus, ConsultationMode, UserRole } from "@/generated/prisma/enums";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import {
  BookingWindowError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SlotHoldExpiredError,
  SlotUnavailableError,
} from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";
import { appointmentReference } from "@/lib/utils/identifiers";
import { applyFixedDiscount, applyPercentageDiscount } from "@/lib/utils/money";

import { acquireSlotHold, releaseSlotHold, verifySlotHold, type SlotHold } from "./slot-lock";

/**
 * The booking engine.
 *
 * Concurrency model, in order of authority:
 *   1. `AppointmentSlot.@@unique([doctorId, startsAt, mode])` — the database
 *      cannot physically hold two bookings for one doctor-instant.
 *   2. A conditional `updateMany` that flips AVAILABLE/HELD → BOOKED and
 *      returns a row count. Postgres serialises the write, so exactly one
 *      concurrent request sees `count === 1`; every other sees 0 and is told
 *      the slot is gone. This is the real guard.
 *   3. The Redis hold — a UX layer that stops two patients reaching payment for
 *      the same slot in the first place. Losing Redis degrades the experience,
 *      not the correctness.
 */

export interface HoldSlotInput {
  slotId: string;
  userId: string;
}

export interface HoldSlotResult {
  hold: SlotHold;
  slot: {
    id: string;
    doctorId: string;
    doctorName: string;
    clinicId: string | null;
    mode: ConsultationMode;
    startsAt: Date;
    endsAt: Date;
    priceMinor: number;
    currency: string;
  };
}

export interface ConfirmBookingInput {
  slotId: string;
  holdToken: string;
  userId: string;
  patientId: string;
  reasonForVisit?: string;
  patientNotes?: string;
  couponCode?: string;
}

export interface ConfirmBookingResult {
  appointmentId: string;
  referenceCode: string;
  status: AppointmentStatus;
  totalMinor: number;
  currency: string;
  requiresPaymentAction: boolean;
  redirectUrl?: string;
}

/** Rejects times outside the bookable window before any lock is taken. */
function assertBookableWindow(startsAt: Date, now: Date): void {
  const leadMinutes = (startsAt.getTime() - now.getTime()) / 60_000;

  if (leadMinutes < 0) {
    throw new BookingWindowError("That appointment time has already passed.");
  }
  if (leadMinutes < env.BOOKING_MIN_LEAD_MINUTES) {
    throw new BookingWindowError(
      `Appointments must be booked at least ${env.BOOKING_MIN_LEAD_MINUTES} minutes in advance.`,
    );
  }

  const advanceDays = leadMinutes / (60 * 24);
  if (advanceDays > env.BOOKING_MAX_ADVANCE_DAYS) {
    throw new BookingWindowError(
      `Appointments can only be booked up to ${env.BOOKING_MAX_ADVANCE_DAYS} days ahead.`,
    );
  }
}

export async function holdSlot(input: HoldSlotInput): Promise<HoldSlotResult> {
  const slot = await prisma.appointmentSlot.findUnique({
    where: { id: input.slotId },
    include: {
      doctor: {
        select: {
          id: true,
          isAcceptingPatients: true,
          vacationMode: true,
          verificationStatus: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  if (!slot) throw new NotFoundError("Appointment slot");

  if (slot.doctor.verificationStatus !== "APPROVED") {
    throw new SlotUnavailableError("This doctor is not currently bookable.");
  }
  if (!slot.doctor.isAcceptingPatients || slot.doctor.vacationMode) {
    throw new SlotUnavailableError("This doctor is not accepting appointments right now.");
  }
  if (slot.status === "BOOKED" || slot.status === "BLOCKED") {
    throw new SlotUnavailableError();
  }

  assertBookableWindow(slot.startsAt, new Date());

  const acquisition = await acquireSlotHold(slot.id, input.userId);
  if (!acquisition.acquired) {
    throw new SlotUnavailableError(
      "Someone else is booking this slot right now. Try another time, or check back shortly.",
    );
  }

  // Mirror the hold into Postgres so an expiry sweep can reconcile the row even
  // if Redis is flushed; Redis remains the source of truth for the countdown.
  await prisma.appointmentSlot.updateMany({
    where: { id: slot.id, status: { in: ["AVAILABLE", "HELD"] } },
    data: {
      status: "HELD",
      heldByUserId: input.userId,
      heldUntil: acquisition.hold.expiresAt,
    },
  });

  return {
    hold: acquisition.hold,
    slot: {
      id: slot.id,
      doctorId: slot.doctorId,
      doctorName: slot.doctor.user.name,
      clinicId: slot.clinicId,
      mode: slot.mode,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      priceMinor: slot.priceMinor,
      currency: slot.currency,
    },
  };
}

export async function releaseSlot(
  slotId: string,
  userId: string,
  holdToken: string,
): Promise<void> {
  await releaseSlotHold(slotId, userId, holdToken);
  await prisma.appointmentSlot.updateMany({
    where: { id: slotId, status: "HELD", heldByUserId: userId },
    data: { status: "AVAILABLE", heldByUserId: null, heldUntil: null },
  });
}

/**
 * Resolves a coupon to a discount. Returns zero rather than throwing for an
 * unusable code — a stale coupon should not block a booking, only fail to
 * discount it.
 */
async function resolveDiscount(
  code: string | undefined,
  patientId: string,
  amountMinor: number,
): Promise<{ couponId: string | null; discountMinor: number }> {
  if (!code) return { couponId: null, discountMinor: 0 };

  const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
  const now = new Date();

  if (
    !coupon ||
    !coupon.isActive ||
    coupon.startsAt > now ||
    (coupon.expiresAt && coupon.expiresAt < now) ||
    (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) ||
    amountMinor < coupon.minOrderMinor
  ) {
    return { couponId: null, discountMinor: 0 };
  }

  const redemptions = await prisma.couponRedemption.count({
    where: { couponId: coupon.id, patientId },
  });
  if (redemptions >= coupon.perUserLimit) return { couponId: null, discountMinor: 0 };

  const discountMinor =
    coupon.type === "PERCENTAGE"
      ? applyPercentageDiscount(amountMinor, coupon.value, coupon.maxDiscountMinor)
      : applyFixedDiscount(amountMinor, coupon.value);

  return { couponId: coupon.id, discountMinor };
}

export async function confirmBooking(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  const holdValid = await verifySlotHold(input.slotId, input.userId, input.holdToken);
  if (!holdValid) throw new SlotHoldExpiredError();

  const slot = await prisma.appointmentSlot.findUnique({
    where: { id: input.slotId },
    include: { doctor: { select: { user: { select: { name: true } }, timezone: true } } },
  });
  if (!slot) throw new NotFoundError("Appointment slot");

  assertBookableWindow(slot.startsAt, new Date());

  const { couponId, discountMinor } = await resolveDiscount(
    input.couponCode,
    input.patientId,
    slot.priceMinor,
  );
  const totalMinor = slot.priceMinor - discountMinor;
  const referenceCode = appointmentReference();

  const appointment = await prisma.$transaction(async (tx) => {
    // The decisive step. Postgres serialises this write, so of N concurrent
    // requests exactly one gets count === 1.
    const claimed = await tx.appointmentSlot.updateMany({
      where: {
        id: input.slotId,
        status: { in: ["AVAILABLE", "HELD"] },
        OR: [
          { heldByUserId: input.userId },
          { heldByUserId: null },
          { heldUntil: { lt: new Date() } },
        ],
      },
      data: { status: "BOOKED", heldByUserId: null, heldUntil: null },
    });

    if (claimed.count === 0) throw new SlotUnavailableError();

    const created = await tx.appointment.create({
      data: {
        referenceCode,
        patientId: input.patientId,
        doctorId: slot.doctorId,
        clinicId: slot.clinicId,
        slotId: slot.id,
        mode: slot.mode,
        status: "PENDING_PAYMENT",
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        timezone: slot.doctor.timezone,
        reasonForVisit: input.reasonForVisit ?? null,
        patientNotes: input.patientNotes ?? null,
        feeMinor: slot.priceMinor,
        discountMinor,
        totalMinor,
        currency: slot.currency,
        couponId,
      },
    });

    if (couponId) {
      await tx.coupon.update({
        where: { id: couponId },
        data: { usageCount: { increment: 1 } },
      });
      await tx.couponRedemption.create({
        data: {
          couponId,
          patientId: input.patientId,
          appointmentId: created.id,
          discountMinor,
        },
      });
    }

    return created;
  });

  logger.info(
    { appointmentId: appointment.id, slotId: slot.id, totalMinor },
    "Appointment created, awaiting payment",
  );

  // A free appointment (fully discounted) skips the payment provider entirely.
  if (totalMinor === 0) {
    await finaliseConfirmedAppointment(appointment.id);
    await releaseSlotHold(input.slotId, input.userId, input.holdToken);
    return {
      appointmentId: appointment.id,
      referenceCode,
      status: "CONFIRMED",
      totalMinor,
      currency: slot.currency,
      requiresPaymentAction: false,
    };
  }

  const payment = await getPaymentAdapter().createPayment({
    amountMinor: totalMinor,
    currency: slot.currency,
    appointmentId: appointment.id,
    patientId: input.patientId,
    description: `Consultation with ${slot.doctor.user.name}`,
    idempotencyKey: `appt-${appointment.id}`,
    returnUrl: `${env.APP_URL}/appointments/${appointment.id}`,
  });

  if (!payment.ok) {
    // Roll the slot back so a declined card does not silently consume it.
    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "EXPIRED", cancellationReason: payment.errorMessage },
      }),
      prisma.appointmentSlot.update({
        where: { id: slot.id },
        data: { status: "AVAILABLE" },
      }),
    ]);
    await releaseSlotHold(input.slotId, input.userId, input.holdToken);
    throw new ConflictError(payment.errorMessage);
  }

  await prisma.payment.create({
    data: {
      appointmentId: appointment.id,
      patientId: input.patientId,
      provider: getPaymentAdapter().provider,
      status: payment.data.status === "succeeded" ? "SUCCEEDED" : "PENDING",
      amountMinor: totalMinor,
      currency: slot.currency,
      providerPaymentId: payment.data.providerPaymentId,
      providerIntentId: payment.data.providerIntentId ?? null,
      idempotencyKey: `appt-${appointment.id}`,
      paidAt: payment.data.status === "succeeded" ? new Date() : null,
    },
  });

  if (payment.data.status === "succeeded") {
    await finaliseConfirmedAppointment(appointment.id);
    await releaseSlotHold(input.slotId, input.userId, input.holdToken);
    return {
      appointmentId: appointment.id,
      referenceCode,
      status: "CONFIRMED",
      totalMinor,
      currency: slot.currency,
      requiresPaymentAction: false,
    };
  }

  return {
    appointmentId: appointment.id,
    referenceCode,
    status: "PENDING_PAYMENT",
    totalMinor,
    currency: slot.currency,
    requiresPaymentAction: true,
    redirectUrl: payment.data.redirectUrl,
  };
}

/** Marks an appointment confirmed and provisions a video room when needed. */
export async function finaliseConfirmedAppointment(appointmentId: string): Promise<void> {
  const appointment = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      patient: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  if (appointment.mode !== "VIDEO") return;

  const room = await getVideoAdapter().createRoom({
    appointmentId: appointment.id,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    doctorName: appointment.doctor.user.name,
    patientName: appointment.patient.user.name,
  });

  if (!room.ok) {
    // A missing room must not void a paid booking — it is recoverable, and the
    // consultation can fall back to a phone call.
    logger.error(
      { appointmentId, error: room.errorMessage },
      "Video room provisioning failed; appointment remains confirmed",
    );
    return;
  }

  await prisma.videoSession.create({
    data: {
      appointmentId: appointment.id,
      provider: room.data.provider,
      roomName: room.data.roomName,
      roomUrl: room.data.roomUrl,
      doctorToken: room.data.doctorToken,
      patientToken: room.data.patientToken,
      expiresAt: room.data.expiresAt,
    },
  });
}

export interface CancelInput {
  appointmentId: string;
  actorUserId: string;
  actorRole: UserRole;
  reason?: string;
}

/**
 * Cancels an appointment and returns the slot to the pool.
 *
 * Refund policy: a patient cancelling inside the free window, or any
 * doctor-side cancellation, is refunded in full. Late patient cancellations are
 * not automatically refunded — support can still issue one manually.
 */
export async function cancelAppointment(input: CancelInput): Promise<{ refunded: boolean }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: {
      payment: true,
      patient: { select: { userId: true } },
      doctor: { select: { userId: true } },
    },
  });

  if (!appointment) throw new NotFoundError("Appointment");

  const isPatient = appointment.patient.userId === input.actorUserId;
  const isDoctor = appointment.doctor.userId === input.actorUserId;
  const isAdmin = input.actorRole === "ADMIN" || input.actorRole === "SUPER_ADMIN";

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new ForbiddenError("You cannot cancel this appointment.");
  }

  const cancellable: AppointmentStatus[] = ["PENDING_PAYMENT", "CONFIRMED"];
  if (!cancellable.includes(appointment.status)) {
    throw new ConflictError(`An appointment that is ${appointment.status} cannot be cancelled.`);
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: "booking.cancellation_window_hours" },
  });
  const windowHours = Number(setting?.value ?? 24);
  const hoursUntil = (appointment.startsAt.getTime() - Date.now()) / 3_600_000;

  const cancelledByRole: UserRole = isPatient ? "PATIENT" : isDoctor ? "DOCTOR" : input.actorRole;
  const eligibleForRefund = !isPatient || hoursUntil >= windowHours;

  let refunded = false;

  if (
    eligibleForRefund &&
    appointment.payment &&
    appointment.payment.status === "SUCCEEDED" &&
    appointment.payment.providerPaymentId
  ) {
    const refundable = appointment.payment.amountMinor - appointment.payment.refundedMinor;

    if (refundable > 0) {
      const result = await getPaymentAdapter().refund({
        providerPaymentId: appointment.payment.providerPaymentId,
        amountMinor: refundable,
        reason: "appointment_cancelled",
        idempotencyKey: `refund-${appointment.id}`,
      });

      if (result.ok) {
        refunded = true;
        await prisma.payment.update({
          where: { id: appointment.payment.id },
          data: {
            status: "REFUNDED",
            refundedMinor: appointment.payment.refundedMinor + result.data.refundedMinor,
            refundedAt: new Date(),
          },
        });
        await prisma.transaction.create({
          data: {
            paymentId: appointment.payment.id,
            type: "REFUND",
            amountMinor: result.data.refundedMinor,
            currency: appointment.currency,
            description: `Refund for appointment ${appointment.referenceCode}`,
            reference: result.data.providerRefundId,
          },
        });
      } else {
        logger.error(
          { appointmentId: appointment.id, error: result.errorMessage },
          "Refund failed during cancellation",
        );
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: isDoctor ? "CANCELLED_BY_DOCTOR" : "CANCELLED_BY_PATIENT",
        cancelledAt: new Date(),
        cancellationReason: input.reason ?? null,
        cancelledByRole,
      },
    });

    // Return the slot to the pool only if it is still in the future.
    if (appointment.slotId && appointment.startsAt > new Date()) {
      await tx.appointmentSlot.updateMany({
        where: { id: appointment.slotId },
        data: { status: "AVAILABLE", heldByUserId: null, heldUntil: null },
      });
    }
  });

  logger.info(
    { appointmentId: appointment.id, cancelledByRole, refunded },
    "Appointment cancelled",
  );

  return { refunded };
}

export interface RescheduleInput {
  appointmentId: string;
  newSlotId: string;
  userId: string;
  patientId: string;
}

/**
 * Moves an appointment to a new slot, carrying the original payment across.
 * The new slot is claimed before the old one is released, so a failure never
 * leaves the patient with no appointment at all.
 */
export async function rescheduleAppointment(
  input: RescheduleInput,
): Promise<{ appointmentId: string; referenceCode: string }> {
  const original = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { patient: { select: { userId: true } } },
  });

  if (!original) throw new NotFoundError("Appointment");
  if (original.patient.userId !== input.userId) {
    throw new ForbiddenError("You cannot reschedule this appointment.");
  }
  if (original.status !== "CONFIRMED" && original.status !== "PENDING_PAYMENT") {
    throw new ConflictError(`An appointment that is ${original.status} cannot be rescheduled.`);
  }

  const newSlot = await prisma.appointmentSlot.findUnique({ where: { id: input.newSlotId } });
  if (!newSlot) throw new NotFoundError("Appointment slot");
  if (newSlot.doctorId !== original.doctorId) {
    throw new ConflictError("A rescheduled appointment must stay with the same doctor.");
  }

  assertBookableWindow(newSlot.startsAt, new Date());

  const referenceCode = appointmentReference();

  const moved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.appointmentSlot.updateMany({
      where: { id: newSlot.id, status: { in: ["AVAILABLE", "HELD"] } },
      data: { status: "BOOKED", heldByUserId: null, heldUntil: null },
    });
    if (claimed.count === 0) throw new SlotUnavailableError();

    const created = await tx.appointment.create({
      data: {
        referenceCode,
        patientId: original.patientId,
        doctorId: original.doctorId,
        clinicId: newSlot.clinicId,
        slotId: newSlot.id,
        mode: newSlot.mode,
        status: original.status,
        startsAt: newSlot.startsAt,
        endsAt: newSlot.endsAt,
        timezone: original.timezone,
        reasonForVisit: original.reasonForVisit,
        patientNotes: original.patientNotes,
        feeMinor: original.feeMinor,
        discountMinor: original.discountMinor,
        totalMinor: original.totalMinor,
        currency: original.currency,
        confirmedAt: original.confirmedAt,
        rescheduledFromId: original.id,
      },
    });

    await tx.appointment.update({
      where: { id: original.id },
      data: {
        status: "CANCELLED_BY_PATIENT",
        cancelledAt: new Date(),
        cancellationReason: "Rescheduled by patient",
        cancelledByRole: "PATIENT",
      },
    });

    if (original.slotId) {
      await tx.appointmentSlot.updateMany({
        where: { id: original.slotId },
        data: { status: "AVAILABLE", heldByUserId: null, heldUntil: null },
      });
    }

    return created;
  });

  logger.info(
    { from: original.id, to: moved.id, slotId: newSlot.id },
    "Appointment rescheduled",
  );

  return { appointmentId: moved.id, referenceCode };
}

/**
 * Reconciliation sweep for holds whose Redis key vanished (expiry during an
 * outage, or a flush) leaving the Postgres row stuck in HELD.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const result = await prisma.appointmentSlot.updateMany({
    where: { status: "HELD", heldUntil: { lt: new Date() } },
    data: { status: "AVAILABLE", heldByUserId: null, heldUntil: null },
  });

  if (result.count > 0) {
    logger.info({ released: result.count }, "Expired slot holds reclaimed");
  }
  return result.count;
}

/** Expires unpaid appointments whose payment window has closed. */
export async function expireUnpaidAppointments(): Promise<number> {
  const cutoff = new Date(Date.now() - env.SLOT_HOLD_TTL_SECONDS * 1000);

  const stale = await prisma.appointment.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff } },
    select: { id: true, slotId: true },
  });

  if (stale.length === 0) return 0;

  await prisma.$transaction([
    prisma.appointment.updateMany({
      where: { id: { in: stale.map((a) => a.id) } },
      data: { status: "EXPIRED", cancellationReason: "Payment was not completed in time" },
    }),
    prisma.appointmentSlot.updateMany({
      where: {
        id: { in: stale.map((a) => a.slotId).filter((id): id is string => id !== null) },
        startsAt: { gt: new Date() },
      },
      data: { status: "AVAILABLE", heldByUserId: null, heldUntil: null },
    }),
  ]);

  logger.info({ expired: stale.length }, "Unpaid appointments expired");
  return stale.length;
}
