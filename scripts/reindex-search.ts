
import { reindexDoctors } from "@/features/search/services/doctor-index";
import { prisma } from "@/lib/db/prisma";
import { isSearchAvailable } from "@/lib/search/client";



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
