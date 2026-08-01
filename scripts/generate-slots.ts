/**
 * Env comes from Node's `--env-file-if-exists` flag in the npm script. A
 * `dotenv.config()` call here would run after the static imports below are
 * evaluated, which is too late for `@/lib/config/env`.
 */
import { generateSlots, type AvailabilityRuleInput } from "@/features/booking/services/slot-generator";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Rolls the bookable horizon forward.
 *
 * Slots are materialised rows, not computed on read, so without this the
 * calendar would slowly run out as time passes. Run it nightly.
 *
 * It only ever *adds*: `skipDuplicates` means an existing AVAILABLE, HELD or
 * BOOKED slot at the same (doctor, instant, mode) is left untouched. The job is
 * therefore safe to run repeatedly and cannot disturb a booked appointment.
 */

const HORIZON_DAYS = Number(process.env.SLOT_HORIZON_DAYS ?? 60);

async function main(): Promise<void> {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const doctors = await prisma.doctor.findMany({
    where: { verificationStatus: "APPROVED", deletedAt: null },
    select: {
      id: true,
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
      availabilityRules: { where: { isActive: true } },
      availabilityExceptions: { where: { date: { gte: now } } },
    },
  });

  let created = 0;

  for (const doctor of doctors) {
    if (doctor.availabilityRules.length === 0) continue;

    const feeByMode = {
      ...(doctor.supportsInPerson ? { IN_PERSON: doctor.inPersonFeeMinor } : {}),
      ...(doctor.supportsVideo ? { VIDEO: doctor.videoFeeMinor } : {}),
      ...(doctor.supportsPhone ? { PHONE: doctor.phoneFeeMinor } : {}),
    };

    const rules: AvailabilityRuleInput[] = doctor.availabilityRules.map((rule) => ({
      id: rule.id,
      clinicId: rule.clinicId,
      mode: rule.mode,
      dayOfWeek: rule.dayOfWeek,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
      slotDurationMinutes: rule.slotDurationMinutes,
      breakStartMinute: rule.breakStartMinute,
      breakEndMinute: rule.breakEndMinute,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      isActive: rule.isActive,
    }));

    const slots = generateSlots({
      doctorId: doctor.id,
      timezone: doctor.timezone,
      rules,
      exceptions: doctor.availabilityExceptions.map((exception) => ({
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

    if (slots.length === 0) continue;

    const result = await prisma.appointmentSlot.createMany({
      data: slots.map((slot) => ({
        doctorId: slot.doctorId,
        clinicId: slot.clinicId,
        mode: slot.mode,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        priceMinor: slot.priceMinor,
        currency: slot.currency,
      })),
      skipDuplicates: true,
    });

    created += result.count;
  }

  logger.info({ doctors: doctors.length, created, horizonDays: HORIZON_DAYS }, "Slot horizon extended");
  console.log(`Added ${created} slot(s) across ${doctors.length} doctor(s), ${HORIZON_DAYS} days ahead.`);
}

main()
  .catch((error) => {
    logger.error({ err: error }, "Slot generation failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
