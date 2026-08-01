import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { MeilisearchDoctorRepository } from "@/features/doctors/repositories/meilisearch-doctor.repository";
import type { DoctorRepository } from "@/features/doctors/repositories/doctor.repository";
import type { DoctorSearchResult } from "@/features/doctors/domain/doctor";

/**
 * The Meilisearch decorator.
 *
 * Two behaviours matter here and neither needs a running Meilisearch:
 *   1. Filter strings are assembled correctly and values are escaped — the
 *      filter is a query language, so an unescaped quote is an injection.
 *   2. Every failure mode falls through to Postgres rather than surfacing an
 *      error to the patient.
 */

const emptyResult: DoctorSearchResult = {
  doctors: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
  facets: { cities: [], specialties: [], languages: [], modes: [] },
};

function makeFallback(): DoctorRepository & { search: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async () => emptyResult),
    findBySlug: vi.fn(async () => null),
    findFeatured: vi.fn(async () => []),
    listCities: vi.fn(async () => ["Karachi"]),
  } as DoctorRepository & { search: ReturnType<typeof vi.fn> };
}

vi.mock("@/lib/search/client", () => ({
  DOCTOR_INDEX: "doctors",
  isSearchAvailable: vi.fn(),
  getSearchClient: vi.fn(),
  resetSearchHealthCache: vi.fn(),
}));

const searchClient = await import("@/lib/search/client");

/** Captures the options Meilisearch was called with. */
function stubIndex(response: unknown, capture?: { options?: Record<string, unknown> }) {
  const search = vi.fn(async (_query: string, options: Record<string, unknown>) => {
    if (capture) capture.options = options;
    return response;
  });

  vi.mocked(searchClient.getSearchClient).mockReturnValue({
    index: () => ({ search, getStats: async () => ({ numberOfDocuments: 5 }) }),
  } as never);

  return search;
}

beforeEach(() => {
  vi.mocked(searchClient.isSearchAvailable).mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Meilisearch doctor repository", () => {
  describe("filter construction", () => {
    it("always restricts results to verified doctors", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 3, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({ query: "heart" });

      expect(capture.options?.filter).toContain("isVerified = true");
    });

    it("translates each filter into its clause", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 1, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({
        city: "Karachi",
        specialty: "Cardiology",
        language: "Urdu",
        gender: "FEMALE",
        mode: "VIDEO",
        minRating: 4,
        minExperience: 10,
        maxFeeMinor: 300_000,
      });

      const filter = capture.options?.filter as string[];
      expect(filter).toContain('city = "Karachi"');
      expect(filter).toContain('specialties = "Cardiology"');
      expect(filter).toContain('languages = "Urdu"');
      expect(filter).toContain('gender = "FEMALE"');
      expect(filter).toContain('modes = "VIDEO"');
      expect(filter).toContain("ratingAverage >= 4");
      expect(filter).toContain("yearsOfExperience >= 10");
      expect(filter).toContain("fromFeeMinor <= 300000");
    });

    it("escapes quotes so a value cannot break out of the filter", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 0, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({
        query: "x",
        city: 'Karachi" OR isVerified = false OR city = "',
      });

      const filter = (capture.options?.filter as string[]).join(" ");
      // The injected quotes must be escaped, leaving one balanced literal.
      expect(filter).toContain('\\"');
      expect(filter).toContain("isVerified = true");
    });

    it("omits absent filters entirely", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 2, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({ query: "skin" });

      expect(capture.options?.filter).toEqual(["isVerified = true"]);
    });
  });

  describe("sorting", () => {
    it.each([
      ["rating_desc", ["ratingAverage:desc", "ratingCount:desc"]],
      ["experience_desc", ["yearsOfExperience:desc"]],
      ["fee_asc", ["fromFeeMinor:asc"]],
      ["fee_desc", ["fromFeeMinor:desc"]],
      ["earliest_available", ["nextAvailableAtUnix:asc"]],
    ] as const)("maps %s", async (sort, expected) => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 1, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({ sort });

      expect(capture.options?.sort).toEqual(expected);
    });

    it("leaves relevance to the ranking rules", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 1, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({ sort: "relevance" });

      expect(capture.options?.sort).toEqual([]);
    });
  });

  describe("pagination", () => {
    it("converts page number to offset", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 40, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({ page: 3, pageSize: 12 });

      expect(capture.options?.offset).toBe(24);
      expect(capture.options?.limit).toBe(12);
    });

    it("clamps a nonsensical page to the first", async () => {
      const capture: { options?: Record<string, unknown> } = {};
      stubIndex({ hits: [], estimatedTotalHits: 5, facetDistribution: {} }, capture);

      await new MeilisearchDoctorRepository(makeFallback()).search({ page: -4 });

      expect(capture.options?.offset).toBe(0);
    });
  });

  describe("degradation to Postgres", () => {
    it("falls back when Meilisearch is unreachable", async () => {
      vi.mocked(searchClient.isSearchAvailable).mockResolvedValue(false);
      const fallback = makeFallback();

      await new MeilisearchDoctorRepository(fallback).search({ query: "heart" });

      expect(fallback.search).toHaveBeenCalledOnce();
    });

    it("falls back when the query throws", async () => {
      vi.mocked(searchClient.getSearchClient).mockReturnValue({
        index: () => ({
          search: async () => {
            throw new Error("connection reset");
          },
        }),
      } as never);
      const fallback = makeFallback();

      await new MeilisearchDoctorRepository(fallback).search({ query: "heart" });

      expect(fallback.search).toHaveBeenCalledOnce();
    });

    it("falls back when the index is empty, rather than showing no doctors", async () => {
      // An unbuilt index looks identical to "no matches" — but showing an empty
      // marketplace because a reindex never ran would be a silent outage.
      const search = vi.fn(async () => ({
        hits: [],
        estimatedTotalHits: 0,
        facetDistribution: {},
      }));
      vi.mocked(searchClient.getSearchClient).mockReturnValue({
        index: () => ({ search, getStats: async () => ({ numberOfDocuments: 0 }) }),
      } as never);

      const fallback = makeFallback();
      await new MeilisearchDoctorRepository(fallback).search({});

      expect(fallback.search).toHaveBeenCalledOnce();
    });

    it("does not fall back on a genuine zero-result query", async () => {
      const search = vi.fn(async () => ({
        hits: [],
        estimatedTotalHits: 0,
        facetDistribution: {},
      }));
      vi.mocked(searchClient.getSearchClient).mockReturnValue({
        index: () => ({ search, getStats: async () => ({ numberOfDocuments: 42 }) }),
      } as never);

      const fallback = makeFallback();
      const result = await new MeilisearchDoctorRepository(fallback).search({
        query: "zzzznotadoctor",
      });

      expect(fallback.search).not.toHaveBeenCalled();
      expect(result.total).toBe(0);
    });
  });

  describe("delegation", () => {
    it("reads profiles from Postgres, never the index", async () => {
      const fallback = makeFallback();
      const repository = new MeilisearchDoctorRepository(fallback);

      await repository.findBySlug("ayesha-siddiqui-cardiology");
      await repository.findFeatured(4);
      await repository.listCities();

      expect(fallback.findBySlug).toHaveBeenCalledWith("ayesha-siddiqui-cardiology");
      expect(fallback.findFeatured).toHaveBeenCalledWith(4);
      expect(fallback.listCities).toHaveBeenCalledOnce();
    });
  });
});
