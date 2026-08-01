
import {
  expireUnpaidAppointments,
  sweepExpiredHolds,
} from "@/features/booking/services/booking.service";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";


async function main(): Promise<void> {
  const startedAt = Date.now();

  const [releasedSlots, expiredAppointments] = await Promise.all([
    sweepExpiredHolds(),
    expireUnpaidAppointments(),
  ]);

  logger.info(
    { releasedSlots, expiredAppointments, durationMs: Date.now() - startedAt },
    "Slot sweep complete",
  );

  console.log(
    `Released ${releasedSlots} stale hold(s), expired ${expiredAppointments} unpaid appointment(s).`,
  );
}

main()
  .catch((error) => {
    logger.error({ err: error }, "Slot sweep failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
