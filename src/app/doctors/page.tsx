import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DoctorCard } from "@/features/doctors/components/doctor-card";
import { DoctorFilters } from "@/features/doctors/components/doctor-filters";
import { DoctorSort } from "@/features/doctors/components/doctor-sort";
import { DoctorCardSkeleton } from "@/features/doctors/components/doctor-card-skeleton";
import { getDoctorRepository } from "@/features/doctors/repositories";
import type { ConsultationMode, Gender } from "@/generated/prisma/enums";
import type { DoctorSearchFilters, DoctorSortKey } from "@/features/doctors/domain/doctor";

export const metadata: Metadata = {
  title: "Find a doctor",
  description:
    "Search verified doctors by specialty, city, language and consultation type. Compare fees, ratings and real availability.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const SORT_KEYS: DoctorSortKey[] = [
  "relevance",
  "rating_desc",
  "experience_desc",
  "fee_asc",
  "fee_desc",
  "earliest_available",
];

const MODES: ConsultationMode[] = ["IN_PERSON", "VIDEO", "PHONE"];
const GENDERS: Gender[] = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];

/** Untrusted query strings are narrowed to the union types the domain expects. */
function parseFilters(params: SearchParams): DoctorSearchFilters {
  const sort = first(params.sort);
  const mode = first(params.mode);
  const gender = first(params.gender);

  return {
    query: first(params.q),
    city: first(params.city),
    specialty: first(params.specialty),
    hospital: first(params.hospital),
    language: first(params.language),
    gender: GENDERS.includes(gender as Gender) ? (gender as Gender) : undefined,
    mode: MODES.includes(mode as ConsultationMode) ? (mode as ConsultationMode) : undefined,
    minRating: toNumber(first(params.minRating)),
    minExperience: toNumber(first(params.minExperience)),
    maxFeeMinor: toNumber(first(params.maxFee)),
    availableToday: first(params.availableToday) === "true",
    sort: SORT_KEYS.includes(sort as DoctorSortKey) ? (sort as DoctorSortKey) : "relevance",
    page: toNumber(first(params.page)) ?? 1,
    pageSize: 10,
  };
}

async function DoctorResults({ params }: { params: SearchParams }) {
  const filters = parseFilters(params);
  const result = await getDoctorRepository().search(filters);

  return (
    <div className="container grid gap-8 py-8 lg:grid-cols-[280px_1fr]">
      <DoctorFilters facets={result.facets} total={result.total} />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {filters.query ? `Results for “${filters.query}”` : "All doctors"}
          </h1>
          <DoctorSort />
        </div>

        {result.doctors.length > 0 ? (
          <>
            <div className="grid gap-4">
              {result.doctors.map((doctor) => (
                <DoctorCard key={doctor.id} doctor={doctor} />
              ))}
            </div>

            {result.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between border-t pt-4"
              >
                <PaginationLink
                  params={params}
                  page={result.page - 1}
                  disabled={result.page <= 1}
                  label="Previous"
                />
                <p className="text-sm text-muted-foreground">
                  Page {result.page} of {result.totalPages}
                </p>
                <PaginationLink
                  params={params}
                  page={result.page + 1}
                  disabled={result.page >= result.totalPages}
                  label="Next"
                />
              </nav>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <SearchX aria-hidden className="size-8 text-muted-foreground" />
              <p className="font-medium">No doctors match those filters</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Try widening the city, removing the rating floor, or including video consultations.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/doctors">Clear all filters</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function PaginationLink({
  params,
  page,
  disabled,
  label,
}: {
  params: SearchParams;
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span aria-disabled className="text-sm text-muted-foreground opacity-50">
        {label}
      </span>
    );
  }

  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = first(value);
    if (single !== undefined && key !== "page") next.set(key, single);
  }
  next.set("page", String(page));

  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/doctors?${next}`}>{label}</Link>
    </Button>
  );
}

export default async function DoctorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <Suspense
      key={JSON.stringify(params)}
      fallback={
        <div className="container grid gap-8 py-8 lg:grid-cols-[280px_1fr]">
          <div className="hidden h-96 rounded-xl border bg-card lg:block" />
          <div className="grid gap-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <DoctorCardSkeleton key={index} />
            ))}
          </div>
        </div>
      }
    >
      <DoctorResults params={params} />
    </Suspense>
  );
}
