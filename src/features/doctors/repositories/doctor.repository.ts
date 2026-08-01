import type {
  DoctorProfile,
  DoctorSearchFilters,
  DoctorSearchResult,
  DoctorSummary,
} from "../domain/doctor";

/**
 * The marketplace's data-access contract.
 *
 * Services depend on this interface, never on Prisma or Meilisearch directly.
 * Three implementations satisfy it: Postgres (source of truth), Meilisearch
 * (typo-tolerant search), and in-memory (design preview and unit tests).
 */
export interface DoctorRepository {
  search(filters: DoctorSearchFilters): Promise<DoctorSearchResult>;
  findBySlug(slug: string): Promise<DoctorProfile | null>;
  findFeatured(limit: number): Promise<DoctorSummary[]>;
  listCities(): Promise<string[]>;
}
