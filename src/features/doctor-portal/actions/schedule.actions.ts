"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { generateSlots, type AvailabilityRuleInput } from "@/features/booking/services/slot-generator";
import { runAction, type ActionResult } from "@/lib/actions/action-result";
import { recordAudit } from "@/lib/audit/audit-log";
import { requireDoctor } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { clientIdentifier } from "@/lib/rate-limit";
import { MINUTES_PER_DAY } from "@/lib/utils/datetime";

/**
 * Schedule management.
 *
 * Changing working hours regenerates the doctor's future slot calendar. The
 * regeneration is deliberately non-destructive: slots that are already HELD or
 * BOOKED are never removed, because a patient with a confirmed appointment must
 * not lose it because the doctor edited next Tuesday's hours.
 */

const HORIZON_DAYS = 60;

const ruleSchema = z
  .object({
    clinicId: z.string().min(1).nullable().default(null),
    mode: z.enum(["IN_PERSON", "VIDEO", "PHONE"]),
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTES_PER_DAY),
    endMinute: z.number().int().min(1).max(MINUTES_PER_DAY),
    slotDurationMinutes: z.number().int().min(5).max(240),
    breakStartMinute: z.number().int().min(0).max(MINUTES_PER_DAY).nullable().default(null),
    breakEndMinute: z.number().int().min(0).max(MINUTES_PER_DAY).nullable().default(null),
  })
  .refine((rule) => rule.endMinute > rule.startMinute, {
    message: "The end time must be after the start time.",
    path: ["endMinute"],
  })
  .refine((rule) => rule.endMinute - rule.startMinute >= rule.slotDurationMinutes, {
    message: "The working window is shorter than one appointment.",
    path: ["slotDurationMinutes"],
  })
  .refine(
    (rule) =>
      (rule.breakStartMinute === null) === (rule.breakEndMinute === null) &&
      (rule.breakStartMinute === null ||
        (rule.breakEndMinute as number) > (rule.breakStartMinute as number)),
    { message: "A break needs both a start and a later end.", path: ["breakEndMinute"] },
  )
  .refine(
    (rule) =>
      rule.breakStartMinute === null ||
      (rule.breakStartMinute >= rule.startMinute &&
        (rule.breakEndMinute as number) <= rule.endMinute),
    { message: "The break must fall inside the working window.", path: ["breakStartMinute"] },
  );

const saveScheduleSchema = z.object({
  rules: z.array(ruleSchema).max(50),
});

const vacationSchema = z
  .object({
    enabled: z.boolean(),
    startsAt: z.string().datetime().nullable().default(null),
    endsAt: z.string().datetime().nullable().default(null),
  })
  .refine(
    (input) =>
      !input.enabled ||
      (input.startsAt !== null &&
        input.endsAt !== null &&
        new Date(input.endsAt) > new Date(input.startsAt)),
    { message: "Vacation needs a start and a later end date.", path: ["endsAt"] },
  );

/** Two rules for the same clinic, mode and day must not overlap in time. */
function assertNoOverlaps(rules: z.infer<typeof ruleSchema>[]): void {
  const grouped = new Map<string, z.infer<typeof ruleSchema>[]>();

  for (const rule of rules) {
    const key = `${rule.clinicId ?? "none"}|${rule.mode}|${rule.dayOfWeek}`;
    grouped.set(key, [...(grouped.get(key) ?? []), rule]);
  }

  for (const group of grouped.values()) {
    const sorted = [...group].sort((a, b) => a.startMinute - b.startMinute);

    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (!previous || !current) continue;

      if (current.startMinute < previous.endMinute) {
        throw new ConflictError(
          "Two working periods overlap. Adjust the times so they do not collide.",
        );
      }
    }
  }
}

export async function saveScheduleAction(input: unknown): Promise<ActionResult<{ slots: number }>> {
  return runAction("saveSchedule", async () => {
    const parsed = saveScheduleSchema.parse(input);
    const { user, doctorId } = await requireDoctor();

    assertNoOverlaps(parsed.rules);

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        timezone: true,
        bufferMinutes: true,
        currency: true,
        inPersonFeeMinor: true,
        videoFeeMinor: true,
        phoneFeeMinor: true,
        supportsInPerson: true,
        supportsVideo: true,
        supportsPhone: true,
        vacationMode: true,
        vacationStartsAt: true,
        vacationEndsAt: true,
      },
    });
    if (!doctor) throw new NotFoundError("Doctor profile");

    const previous = await prisma.availabilityRule.findMany({ where: { doctorId } });

    const feeByMode = {
      ...(doctor.supportsInPerson ? { IN_PERSON: doctor.inPersonFeeMinor } : {}),
      ...(doctor.supportsVideo ? { VIDEO: doctor.videoFeeMinor } : {}),
      ...(doctor.supportsPhone ? { PHONE: doctor.phoneFeeMinor } : {}),
    };

    const unsupported = parsed.rules.find((rule) => !(rule.mode in feeByMode));
    if (unsupported) {
      throw new ValidationError(
        `You have not enabled ${unsupported.mode.replace("_", " ").toLowerCase()} consultations, so hours cannot be set for them.`,
      );
    }

    const now = new Date();
    const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({ where: { doctorId } });

      await tx.availabilityRule.createMany({
        data: parsed.rules.map((rule) => ({
          doctorId,
          clinicId: rule.clinicId,
          mode: rule.mode,
          dayOfWeek: rule.dayOfWeek,
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
          slotDurationMinutes: rule.slotDurationMinutes,
          breakStartMinute: rule.breakStartMinute,
          breakEndMinute: rule.breakEndMinute,
        })),
      });

      // Only untaken future slots are cleared. A HELD or BOOKED slot survives a
      // schedule change — the appointment behind it is already a commitment.
      await tx.appointmentSlot.deleteMany({
        where: { doctorId, status: "AVAILABLE", startsAt: { gt: now } },
      });

      const exceptions = await tx.availabilityException.findMany({
        where: { doctorId, date: { gte: now } },
      });

      const generatorRules: AvailabilityRuleInput[] = parsed.rules.map((rule, index) => ({
        id: `rule-${index}`,
        clinicId: rule.clinicId,
        mode: rule.mode,
        dayOfWeek: rule.dayOfWeek,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        slotDurationMinutes: rule.slotDurationMinutes,
        breakStartMinute: rule.breakStartMinute,
        breakEndMinute: rule.breakEndMinute,
        effectiveFrom: new Date(0),
        effectiveTo: null,
        isActive: true,
      }));

      const slots = generateSlots({
        doctorId,
        timezone: doctor.timezone,
        rules: generatorRules,
        exceptions: exceptions.map((exception) => ({
          date: exception.date,
          isAvailable: exception.isAvailable,
          startMinute: exception.startMinute,
          endMinute: exception.endMinute,
        })),
        from: now,
        to: horizonEnd,
        bufferMinutes: doctor.bufferMinutes,
        currency: doctor.currency,
        feeByMode,
        vacation: {
          enabled: doctor.vacationMode,
          startsAt: doctor.vacationStartsAt,
          endsAt: doctor.vacationEndsAt,
        },
        minLeadMinutes: env.BOOKING_MIN_LEAD_MINUTES,
        now,
      });

      if (slots.length > 0) {
        await tx.appointmentSlot.createMany({
          data: slots.map((slot) => ({
            doctorId: slot.doctorId,
            clinicId: slot.clinicId,
            mode: slot.mode,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            priceMinor: slot.priceMinor,
            currency: slot.currency,
          })),
          // A surviving BOOKED slot occupies the same unique key, so a
          // regenerated duplicate is skipped rather than throwing.
          skipDuplicates: true,
        });
      }

      return slots.length;
    });

    const requestHeaders = await headers();
    await recordAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "UPDATE",
      entityType: "AvailabilityRule",
      entityId: doctorId,
      before: { ruleCount: previous.length },
      after: { ruleCount: parsed.rules.length, slotsGenerated: created },
      ipAddress: clientIdentifier(requestHeaders),
      userAgent: requestHeaders.get("user-agent"),
    });

    revalidatePath("/doctor/schedule");
    revalidatePath("/doctor/dashboard");

    return { slots: created };
  });
}

export async function setVacationModeAction(
  input: unknown,
): Promise<ActionResult<{ enabled: boolean }>> {
  return runAction("setVacationMode", async () => {
    const parsed = vacationSchema.parse(input);
    const { user, doctorId } = await requireDoctor();

    const before = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { vacationMode: true, vacationStartsAt: true, vacationEndsAt: true },
    });

    await prisma.doctor.update({
      where: { id: doctorId },
      data: {
        vacationMode: parsed.enabled,
        vacationStartsAt: parsed.startsAt ? new Date(parsed.startsAt) : null,
        vacationEndsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
      },
    });

    // Turning vacation on withdraws untaken slots in the window; existing
    // appointments stay and must be cancelled deliberately by the doctor.
    if (parsed.enabled && parsed.startsAt && parsed.endsAt) {
      await prisma.appointmentSlot.deleteMany({
        where: {
          doctorId,
          status: "AVAILABLE",
          startsAt: { gte: new Date(parsed.startsAt), lte: new Date(parsed.endsAt) },
        },
      });
    }

    await recordAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "UPDATE",
      entityType: "Doctor",
      entityId: doctorId,
      before: before ?? undefined,
      after: {
        vacationMode: parsed.enabled,
        vacationStartsAt: parsed.startsAt,
        vacationEndsAt: parsed.endsAt,
      },
    });

    revalidatePath("/doctor/schedule");

    return { enabled: parsed.enabled };
  });
}
