import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

import type { DoctorRepository } from "./doctor.repository";
import { InMemoryDoctorRepository } from "./in-memory-doctor.repository";
import { MeilisearchDoctorRepository } from "./meilisearch-doctor.repository";
import { PrismaDoctorRepository } from "./prisma-doctor.repository";

/**
 * Resolves the marketplace repository.
 *
 * DEMO_MODE swaps Postgres for the in-memory driver so the interface can be
 * exercised — and the UI reviewed — before the Docker stack is running. The
 * env schema refuses DEMO_MODE in production.
 *
 * Otherwise Postgres is wrapped by the Meilisearch decorator, which serves
 * `search` when the index is reachable and delegates everything else — plus any
 * failure — straight back to Postgres.
 */

let instance: DoctorRepository | undefined;

export function getDoctorRepository(): DoctorRepository {
  if (!instance) {
    if (env.DEMO_MODE) {
      instance = new InMemoryDoctorRepository();
      logger.info({ driver: "in-memory" }, "Doctor repository resolved");
    } else {
      const postgres = new PrismaDoctorRepository();
      instance = env.SEARCH_DRIVER === "meilisearch"
        ? new MeilisearchDoctorRepository(postgres)
        : postgres;
      logger.info({ driver: env.SEARCH_DRIVER === "meilisearch" ? "meilisearch+prisma" : "prisma" }, "Doctor repository resolved");
    }
  }
  return instance;
}

export function setDoctorRepository(repository: DoctorRepository | undefined): void {
  instance = repository;
}

export type { DoctorRepository } from "./doctor.repository";
export { InMemoryDoctorRepository } from "./in-memory-doctor.repository";
export { PrismaDoctorRepository } from "./prisma-doctor.repository";
export { MeilisearchDoctorRepository } from "./meilisearch-doctor.repository";
