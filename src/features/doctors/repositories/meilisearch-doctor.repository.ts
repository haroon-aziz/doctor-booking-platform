import type { DoctorDocument } from "@/features/search/services/doctor-index";
import { logger } from "@/lib/logger";
import { DOCTOR_INDEX, getSearchClient, isSearchAvailable } from "@/lib/search/client";

import type {
  DoctorProfile,
  DoctorSearchFilters,
  DoctorSearchResult,
  DoctorSummary,
  FacetBucket,
} from "../domain/doctor";
import type { DoctorRepository } from "./doctor.repository";

/**
 * Typo-tolerant search, decorating the Postgres repository.
 *
 * Only `search` is served by Meilisearch. `findBySlug`, `findFeatured` and
 * `listCities` delegate to Postgres, because a profile page must reflect the
 * source of truth — an index lagging by one sync is fine for a result grid and
 * unacceptable for the fee shown next to a Book button.
 *
 * If Meilisearch is unreachable, empty, or errors, search falls through to
 * Postgres. The marketplace degrades to exact matching rather than going down,
 * which is the same posture the AI assistant takes toward Ollama.
 */

const PAGE_SIZE = 12;

/** Escapes a value for a Meilisearch filter string literal. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildFilters(filters: DoctorSearchFilters): string[] {
  const clauses: string[] = ["isVerified = true"];

  if (filters.city) clauses.push(`city = ${quote(filters.city)}`);
  if (filters.specialty) clauses.push(`specialties = ${quote(filters.specialty)}`);
  if (filters.hospital) clauses.push(`hospitalName = ${quote(filters.hospital)}`);
  if (filters.language) clauses.push(`languages = ${quote(filters.language)}`);
  if (filters.gender) clauses.push(`gender = ${quote(filters.gender)}`);
  if (filters.mode) clauses.push(`modes = ${quote(filters.mode)}`);
  if (filters.minRating !== undefined) clauses.push(`ratingAverage >= ${filters.minRating}`);
  if (filters.minExperience !== undefined) {
    clauses.push(`yearsOfExperience >= ${filters.minExperience}`);
  }
  if (filters.maxFeeMinor !== undefined) clauses.push(`fromFeeMinor <= ${filters.maxFeeMinor}`);

  if (filters.availableToday) {
    const endOfDay = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    clauses.push(`nextAvailableAtUnix < ${endOfDay}`);
    clauses.push("nextAvailableAtUnix IS NOT NULL");
  }

  return clauses;
}

function buildSort(sort: DoctorSearchFilters["sort"]): string[] {
  switch (sort) {
    case "rating_desc":
      return ["ratingAverage:desc", "ratingCount:desc"];
    case "experience_desc":
      return ["yearsOfExperience:desc"];
    case "fee_asc":
      return ["fromFeeMinor:asc"];
    case "fee_desc":
      return ["fromFeeMinor:desc"];
    case "earliest_available":
      return ["nextAvailableAtUnix:asc"];
    case "relevance":
    case undefined:
    default:
      // No explicit sort: let the ranking rules decide, which is what makes a
      // text query return the best match rather than merely the highest rated.
      return [];
  }
}

function toSummary(document: DoctorDocument): DoctorSummary {
  return {
    id: document.id,
    slug: document.slug,
    fullName: document.fullName,
    title: document.title,
    headline: document.headline,
    avatarUrl: document.avatarUrl,
    gender: document.gender,
    specialties: document.specialties,
    primarySpecialty: document.primarySpecialty,
    yearsOfExperience: document.yearsOfExperience,
    ratingAverage: document.ratingAverage,
    ratingCount: document.ratingCount,
    city: document.city,
    clinicName: document.clinicName,
    hospitalName: document.hospitalName,
    languages: document.languages,
    modes: document.modes,
    fromFeeMinor: document.fromFeeMinor,
    currency: document.currency,
    isVerified: document.isVerified,
    isAcceptingPatients: document.isAcceptingPatients,
    nextAvailableAt: document.nextAvailableAtUnix
      ? new Date(document.nextAvailableAtUnix * 1000).toISOString()
      : null,
  };
}

function toBuckets(
  distribution: Record<string, number> | undefined,
  labeller: (value: string) => string = (value) => value,
): FacetBucket[] {
  if (!distribution) return [];

  return Object.entries(distribution)
    .filter(([value]) => value.length > 0)
    .map(([value, count]) => ({ value, label: labeller(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const MODE_LABEL: Record<string, string> = {
  IN_PERSON: "In person",
  VIDEO: "Video",
  PHONE: "Phone",
};

export class MeilisearchDoctorRepository implements DoctorRepository {
  constructor(private readonly fallback: DoctorRepository) {}

  async search(filters: DoctorSearchFilters): Promise<DoctorSearchResult> {
    if (!(await isSearchAvailable())) {
      logger.debug("Meilisearch unavailable; searching Postgres instead");
      return this.fallback.search(filters);
    }

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? PAGE_SIZE;

    try {
      const response = await getSearchClient()
        .index<DoctorDocument>(DOCTOR_INDEX)
        .search(filters.query ?? "", {
          filter: buildFilters(filters),
          sort: buildSort(filters.sort),
          facets: ["city", "specialties", "languages", "modes"],
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });

      // An empty index is indistinguishable from "no matches" to the caller, but
      // it almost always means the reindex has not run. Falling back keeps the
      // marketplace populated rather than showing a bare "no doctors found".
      if (response.estimatedTotalHits === 0 && !filters.query) {
        const totalDocuments = await this.countDocuments();
        if (totalDocuments === 0) {
          logger.warn("Doctor index is empty; falling back to Postgres");
          return this.fallback.search(filters);
        }
      }

      const total = response.estimatedTotalHits ?? response.hits.length;
      const distribution = response.facetDistribution ?? {};

      return {
        doctors: response.hits.map(toSummary),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        facets: {
          cities: toBuckets(distribution.city),
          specialties: toBuckets(distribution.specialties),
          languages: toBuckets(distribution.languages),
          modes: toBuckets(distribution.modes, (value) => MODE_LABEL[value] ?? value),
        },
      };
    } catch (error) {
      logger.error({ err: error }, "Meilisearch query failed; falling back to Postgres");
      return this.fallback.search(filters);
    }
  }

  private async countDocuments(): Promise<number> {
    try {
      const stats = await getSearchClient().index(DOCTOR_INDEX).getStats();
      return stats.numberOfDocuments;
    } catch {
      return 0;
    }
  }

  findBySlug(slug: string): Promise<DoctorProfile | null> {
    return this.fallback.findBySlug(slug);
  }

  findFeatured(limit: number): Promise<DoctorSummary[]> {
    return this.fallback.findFeatured(limit);
  }

  listCities(): Promise<string[]> {
    return this.fallback.listCities();
  }
}
