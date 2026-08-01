/**
 * Env comes from Node's `--env-file-if-exists` flag in the npm script. A
 * `dotenv.config()` call here would run after the static imports below are
 * evaluated, which is too late for `@/lib/config/env`.
 */
import { reindexDoctors } from "@/features/search/services/doctor-index";
import { prisma } from "@/lib/db/prisma";
import { isSearchAvailable } from "@/lib/search/client";

/**
 * Rebuilds the Meilisearch doctor index from Postgres.
 *
 * Run after seeding, after a bulk import, or whenever the index and the
 * database may have diverged. Individual profile changes are kept in sync
 * incrementally by `syncDoctor`.
 */

async function main(): Promise<void> {
  if (!(await isSearchAvailable())) {
    console.error(
      "Meilisearch is not reachable. Start it with `docker compose up -d meilisearch`.\n" +
        "Search will keep working on Postgres in the meantime, without typo tolerance.",
    );
    process.exitCode = 1;
    return;
  }

  const count = await reindexDoctors();
  console.log(`Indexed ${count} approved doctor(s).`);
}

main()
  .catch((error) => {
    console.error("Reindex failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
