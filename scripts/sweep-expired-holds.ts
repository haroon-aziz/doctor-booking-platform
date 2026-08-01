/**
 * Env comes from Node's `--env-file-if-exists` flag in the npm script. A
 * `dotenv.config()` call here would run after the static imports below are
 * evaluated, which is too late for `@/lib/config/env`.
 */
import {
  expireUnpaidAppointments,
  sweepExpiredHolds,
} from "@/features/booking/services/booking.service";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Reconciliation sweep. Intended to run every few minutes from cron.
 *
 * Redis expiry normally returns a slot on its own. This exists for the cases it
 * cannot cover: a Redis flush or outage that loses the hold key while the
 * Postgres row is still marked HELD, and checkouts abandoned after an
 * appointment row was created but before payment completed.
 *
 * Both operations are idempotent, so overlapping runs are harmless.
 */
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
