import { Prisma, prisma } from "@/lib/db/prisma";
import type { ConsultationMode } from "@/generated/prisma/enums";

import type {
  DoctorProfile,
  DoctorSearchFilters,
  DoctorSearchResult,
  DoctorSummary,
  FacetBucket,
} from "../domain/doctor";
import type { DoctorRepository } from "./doctor.repository";

/**
 * Postgres-backed marketplace repository.
 *
 * Only approved, undeleted doctors are ever visible — that predicate is applied
 * in one place (`visibilityFilter`) rather than repeated per query, because a
 * single missed clause would expose unverified practitioners to patients.
 */

const doctorInclude = {
  user: { select: { name: true, image: true } },
  specialties: { include: { specialty: { select: { name: true } } } },
  languages: { include: { language: { select: { name: true } } } },
  clinics: {
    include: { clinic: { select: { name: true, city: true, addressLine: true } } },
    orderBy: { isPrimary: "desc" },
  },
  affiliations: {
    where: { isCurrent: true },
    include: { hospital: { select: { name: true } } },
  },
  slots: {
    where: { status: "AVAILABLE", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 1,
    select: { startsAt: true },
  },
} satisfies Prisma.DoctorInclude;

type DoctorRow = Prisma.DoctorGetPayload<{ include: typeof doctorInclude }>;

function visibilityFilter(): Prisma.DoctorWhereInput {
  return { deletedAt: null, verificationStatus: "APPROVED" };
}

function lowestFee(row: DoctorRow): number {
  const fees = [
    row.supportsInPerson ? row.inPersonFeeMinor : null,
    row.supportsVideo ? row.videoFeeMinor : null,
    row.supportsPhone ? row.phoneFeeMinor : null,
  ].filter((fee): fee is number => fee !== null && fee > 0);

  return fees.length > 0 ? Math.min(...fees) : 0;
}

function supportedModes(row: DoctorRow): ConsultationMode[] {
  const modes: ConsultationMode[] = [];
  if (row.supportsInPerson) modes.push("IN_PERSON");
  if (row.supportsVideo) modes.push("VIDEO");
  if (row.supportsPhone) modes.push("PHONE");
  return modes;
}

function toSummary(row: DoctorRow): DoctorSummary {
  const primaryClinic = row.clinics[0]?.clinic ?? null;
  const primarySpecialty =
    row.specialties.find((link) => link.isPrimary)?.specialty.name ??
    row.specialties[0]?.specialty.name ??
    "General";

  return {
    id: row.id,
    slug: row.slug,
    fullName: row.user.name,
    title: row.title,
    headline: `${primarySpecialty} · ${row.yearsOfExperience} yrs experience`,
    avatarUrl: row.user.image,
    gender: row.gender,
    specialties: row.specialties.map((link) => link.specialty.name),
    primarySpecialty,
    yearsOfExperience: row.yearsOfExperience,
    ratingAverage: row.ratingAverage,
    ratingCount: row.ratingCount,
    city: primaryClinic?.city ?? "—",
    clinicName: primaryClinic?.name ?? null,
    hospitalName: row.affiliations[0]?.hospital.name ?? null,
    languages: row.languages.map((link) => link.language.name),
    modes: supportedModes(row),
    fromFeeMinor: lowestFee(row),
    currency: row.currency,
    isVerified: row.verificationStatus === "APPROVED",
    isAcceptingPatients: row.isAcceptingPatients && !row.vacationMode,
    nextAvailableAt: row.slots[0]?.startsAt.toISOString() ?? null,
  };
}

function buildWhere(filters: DoctorSearchFilters): Prisma.DoctorWhereInput {
  const conditions: Prisma.DoctorWhereInput[] = [visibilityFilter()];

  if (filters.query) {
    conditions.push({
      OR: [
        { user: { name: { contains: filters.query, mode: "insensitive" } } },
        { bio: { contains: filters.query, mode: "insensitive" } },
        {
          specialties: {
            some: { specialty: { name: { contains: filters.query, mode: "insensitive" } } },
          },
        },
      ],
    });
  }

  if (filters.city) {
    conditions.push({ clinics: { some: { clinic: { city: filters.city } } } });
  }
  if (filters.specialty) {
    conditions.push({ specialties: { some: { specialty: { name: filters.specialty } } } });
  }
  if (filters.hospital) {
    conditions.push({
      affiliations: { some: { isCurrent: true, hospital: { name: filters.hospital } } },
    });
  }
  if (filters.language) {
    conditions.push({ languages: { some: { language: { name: filters.language } } } });
  }
  if (filters.gender) conditions.push({ gender: filters.gender });
  if (filters.minRating != null) conditions.push({ ratingAverage: { gte: filters.minRating } });
  if (filters.minExperience != null) {
    conditions.push({ yearsOfExperience: { gte: filters.minExperience } });
  }

  if (filters.mode === "IN_PERSON") conditions.push({ supportsInPerson: true });
  if (filters.mode === "VIDEO") conditions.push({ supportsVideo: true });
  if (filters.mode === "PHONE") conditions.push({ supportsPhone: true });

  if (filters.maxFeeMinor != null) {
    // "Cheapest supported mode is within budget" — a doctor whose video fee
    // fits must not be excluded because their in-person fee does not.
    conditions.push({
      OR: [
        { supportsInPerson: true, inPersonFeeMinor: { lte: filters.maxFeeMinor } },
        { supportsVideo: true, videoFeeMinor: { lte: filters.maxFeeMinor } },
        { supportsPhone: true, phoneFeeMinor: { lte: filters.maxFeeMinor } },
      ],
    });
  }

  if (filters.availableToday) {
    const dayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    conditions.push({
      slots: { some: { status: "AVAILABLE", startsAt: { gte: new Date(), lte: dayFromNow } } },
    });
  }

  return { AND: conditions };
}

function buildOrderBy(
  sort: DoctorSearchFilters["sort"],
): Prisma.DoctorOrderByWithRelationInput[] {
  switch (sort) {
    case "rating_desc":
      return [{ ratingAverage: "desc" }, { ratingCount: "desc" }];
    case "experience_desc":
      return [{ yearsOfExperience: "desc" }];
    case "fee_asc":
      return [{ inPersonFeeMinor: "asc" }];
    case "fee_desc":
      return [{ inPersonFeeMinor: "desc" }];
    case "earliest_available":
      // Slot ordering cannot be expressed here, so the page is re-sorted in
      // memory once the (bounded) result set is loaded.
      return [{ ratingAverage: "desc" }];
    case "relevance":
    default:
      return [{ ratingAverage: "desc" }, { completedAppointments: "desc" }];
  }
}

export class PrismaDoctorRepository implements DoctorRepository {
  async search(filters: DoctorSearchFilters): Promise<DoctorSearchResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 10));
    const where = buildWhere(filters);

    const [total, rows] = await Promise.all([
      prisma.doctor.count({ where }),
      prisma.doctor.findMany({
        where,
        include: doctorInclude,
        orderBy: buildOrderBy(filters.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    let doctors = rows.map(toSummary);

    if (filters.sort === "earliest_available") {
      const rank = (doctor: DoctorSummary) =>
        doctor.nextAvailableAt ? Date.parse(doctor.nextAvailableAt) : Number.MAX_SAFE_INTEGER;
      doctors = [...doctors].sort((a, b) => rank(a) - rank(b));
    }

    return {
      doctors,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      facets: await this.facets(where),
    };
  }

  /**
   * Facet counts are grouped queries against the *filtered* set, so the numbers
   * next to each option describe what the patient would actually get.
   */
  private async facets(where: Prisma.DoctorWhereInput): Promise<DoctorSearchResult["facets"]> {
    const [cityRows, specialtyRows, languageRows, modeCounts] = await Promise.all([
      prisma.clinic.findMany({
        where: { doctors: { some: { doctor: where } } },
        select: { city: true, doctors: { where: { doctor: where }, select: { doctorId: true } } },
      }),
      prisma.specialty.findMany({
        where: { doctors: { some: { doctor: where } } },
        select: { name: true, _count: { select: { doctors: true } } },
      }),
      prisma.language.findMany({
        where: { doctors: { some: { doctor: where } } },
        select: { name: true, _count: { select: { doctors: true } } },
      }),
      Promise.all([
        prisma.doctor.count({ where: { AND: [where, { supportsInPerson: true }] } }),
        prisma.doctor.count({ where: { AND: [where, { supportsVideo: true }] } }),
        prisma.doctor.count({ where: { AND: [where, { supportsPhone: true }] } }),
      ]),
    ]);

    const cityCounts = new Map<string, number>();
    for (const clinic of cityRows) {
      cityCounts.set(clinic.city, (cityCounts.get(clinic.city) ?? 0) + clinic.doctors.length);
    }

    const toBuckets = (entries: [string, number][]): FacetBucket[] =>
      entries
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const [inPerson, video, phone] = modeCounts;

    return {
      cities: toBuckets([...cityCounts.entries()]),
      specialties: toBuckets(specialtyRows.map((row) => [row.name, row._count.doctors])),
      languages: toBuckets(languageRows.map((row) => [row.name, row._count.doctors])),
      modes: [
        { value: "IN_PERSON", label: "In person", count: inPerson },
        { value: "VIDEO", label: "Video", count: video },
        { value: "PHONE", label: "Phone", count: phone },
      ].filter((bucket) => bucket.count > 0),
    };
  }

  async findBySlug(slug: string): Promise<DoctorProfile | null> {
    const row = await prisma.doctor.findFirst({
      where: { slug, ...visibilityFilter() },
      include: {
        ...doctorInclude,
        education: { orderBy: { endYear: "desc" } },
        certificates: { orderBy: { issuedAt: "desc" } },
        reviews: {
          where: { status: "PUBLISHED", deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { patient: { include: { user: { select: { name: true } } } } },
        },
      },
    });

    if (!row) return null;

    const summary = toSummary(row);
    const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const review of row.reviews) {
      const bucket = Math.min(5, Math.max(1, review.rating)) as 1 | 2 | 3 | 4 | 5;
      breakdown[bucket] += 1;
    }

    const feesByMode: DoctorProfile["feesByMode"] = {};
    if (row.supportsInPerson) feesByMode.IN_PERSON = row.inPersonFeeMinor;
    if (row.supportsVideo) feesByMode.VIDEO = row.videoFeeMinor;
    if (row.supportsPhone) feesByMode.PHONE = row.phoneFeeMinor;

    return {
      ...summary,
      bio: row.bio ?? "",
      education: row.education.map((entry) => ({
        degree: entry.degree,
        institution: entry.institution,
        endYear: entry.endYear,
      })),
      certificates: row.certificates.map((entry) => ({
        name: entry.name,
        issuingBody: entry.issuingBody,
        issuedYear: entry.issuedAt.getUTCFullYear(),
      })),
      affiliations: row.affiliations.map((entry) => ({
        hospitalName: entry.hospital.name,
        position: entry.position,
      })),
      clinicAddress: row.clinics[0]?.clinic.addressLine ?? null,
      consultationDurationMinutes: row.consultationDurationMinutes,
      feesByMode,
      completedAppointments: row.completedAppointments,
      ratingBreakdown: breakdown,
      reviews: row.reviews.map((review) => ({
        id: review.id,
        authorName: review.isAnonymous ? "Anonymous" : review.patient.user.name,
        rating: review.rating,
        title: review.title,
        comment: review.comment ?? "",
        createdAt: review.createdAt.toISOString(),
        doctorReply: review.doctorReply,
      })),
    };
  }

  async findFeatured(limit: number): Promise<DoctorSummary[]> {
    const rows = await prisma.doctor.findMany({
      where: { ...visibilityFilter(), isAcceptingPatients: true, vacationMode: false },
      include: doctorInclude,
      orderBy: [{ ratingAverage: "desc" }, { ratingCount: "desc" }],
      take: limit,
    });
    return rows.map(toSummary);
  }

  async listCities(): Promise<string[]> {
    const rows = await prisma.clinic.findMany({
      where: { isActive: true },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    });
    return rows.map((row) => row.city);
  }
}
