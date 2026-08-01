import type { ConsultationMode, Gender } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { DOCTOR_INDEX, getSearchClient } from "@/lib/search/client";

/**
 * The Meilisearch doctor index.
 *
 * Meilisearch holds a *projection* of the directory, never the source of
 * truth — Postgres does. Anything the index cannot answer authoritatively
 * (fees at booking time, live slot state) is re-read from the database before
 * it is acted on. The index exists to make "cardiologst in karachi" find
 * something, which `ILIKE` cannot.
 */

export interface DoctorDocument {
  id: string;
  slug: string;
  fullName: string;
  title: string;
  headline: string;
  bio: string;
  gender: Gender;
  specialties: string[];
  primarySpecialty: string;
  languages: string[];
  city: string;
  clinicName: string | null;
  hospitalName: string | null;
  modes: ConsultationMode[];
  yearsOfExperience: number;
  ratingAverage: number;
  ratingCount: number;
  fromFeeMinor: number;
  currency: string;
  isVerified: boolean;
  isAcceptingPatients: boolean;
  avatarUrl: string | null;
  /** Unix seconds — Meilisearch sorts numbers, not ISO strings. */
  nextAvailableAtUnix: number | null;
}

/**
 * Ranking rules. `sort` is lifted above `proximity`/`attribute` so an explicit
 * user sort is honoured exactly rather than being blended with text relevance;
 * `rating:desc` is the final tiebreak so equally-relevant doctors surface best
 * first.
 */
const RANKING_RULES = [
  "words",
  "typo",
  "sort",
  "proximity",
  "attribute",
  "exactness",
  "ratingAverage:desc",
];

const SEARCHABLE = [
  "fullName",
  "primarySpecialty",
  "specialties",
  "city",
  "clinicName",
  "hospitalName",
  "headline",
  "bio",
];

const FILTERABLE = [
  "city",
  "specialties",
  "primarySpecialty",
  "languages",
  "gender",
  "modes",
  "hospitalName",
  "ratingAverage",
  "yearsOfExperience",
  "fromFeeMinor",
  "isVerified",
  "isAcceptingPatients",
  "nextAvailableAtUnix",
];

const SORTABLE = [
  "ratingAverage",
  "yearsOfExperience",
  "fromFeeMinor",
  "nextAvailableAtUnix",
  "ratingCount",
];

/** Creates the index if absent and applies settings. Idempotent. */
export async function ensureDoctorIndex(): Promise<void> {
  const client = getSearchClient();

  await client.createIndex(DOCTOR_INDEX, { primaryKey: "id" }).catch((error: unknown) => {
    // Already existing is the normal case on every run after the first.
    const code = (error as { code?: string }).code;
    if (code !== "index_already_exists") throw error;
  });

  const index = client.index<DoctorDocument>(DOCTOR_INDEX);

  await index.updateSettings({
    searchableAttributes: SEARCHABLE,
    filterableAttributes: FILTERABLE,
    sortableAttributes: SORTABLE,
    rankingRules: RANKING_RULES,
    // Two typos on longer words: "cardiologst" and "dermatolgy" are the kinds of
    // misspelling patients actually type.
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    },
    faceting: { maxValuesPerFacet: 100 },
    pagination: { maxTotalHits: 2_000 },
  });

  logger.info({ index: DOCTOR_INDEX }, "Doctor index settings applied");
}

/** Projects approved, non-deleted doctors into index documents. */
export async function buildDoctorDocuments(): Promise<DoctorDocument[]> {
  const doctors = await prisma.doctor.findMany({
    where: { verificationStatus: "APPROVED", deletedAt: null },
    include: {
      user: { select: { name: true, image: true } },
      specialties: { include: { specialty: { select: { name: true } } } },
      languages: { include: { language: { select: { name: true } } } },
      clinics: {
        include: { clinic: { select: { name: true, city: true } } },
        orderBy: { isPrimary: "desc" },
      },
      affiliations: {
        where: { isCurrent: true },
        include: { hospital: { select: { name: true } } },
        take: 1,
      },
      slots: {
        where: { status: "AVAILABLE", startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { startsAt: true },
      },
    },
  });

  return doctors.map((doctor) => {
    const modes: ConsultationMode[] = [
      ...(doctor.supportsInPerson ? (["IN_PERSON"] as const) : []),
      ...(doctor.supportsVideo ? (["VIDEO"] as const) : []),
      ...(doctor.supportsPhone ? (["PHONE"] as const) : []),
    ];

    const fees = [
      ...(doctor.supportsInPerson ? [doctor.inPersonFeeMinor] : []),
      ...(doctor.supportsVideo ? [doctor.videoFeeMinor] : []),
      ...(doctor.supportsPhone ? [doctor.phoneFeeMinor] : []),
    ];

    const primary =
      doctor.specialties.find((link) => link.isPrimary)?.specialty.name ??
      doctor.specialties[0]?.specialty.name ??
      "General";

    const clinic = doctor.clinics[0]?.clinic ?? null;
    const nextSlot = doctor.slots[0]?.startsAt ?? null;

    return {
      id: doctor.id,
      slug: doctor.slug,
      fullName: doctor.user.name,
      title: doctor.title,
      headline: `${primary} · ${doctor.yearsOfExperience} years`,
      bio: doctor.bio ?? "",
      gender: doctor.gender,
      specialties: doctor.specialties.map((link) => link.specialty.name),
      primarySpecialty: primary,
      languages: doctor.languages.map((link) => link.language.name),
      city: clinic?.city ?? "",
      clinicName: clinic?.name ?? null,
      hospitalName: doctor.affiliations[0]?.hospital.name ?? null,
      modes,
      yearsOfExperience: doctor.yearsOfExperience,
      ratingAverage: doctor.ratingAverage,
      ratingCount: doctor.ratingCount,
      fromFeeMinor: fees.length > 0 ? Math.min(...fees) : 0,
      currency: doctor.currency,
      isVerified: doctor.verificationStatus === "APPROVED",
      isAcceptingPatients: doctor.isAcceptingPatients,
      avatarUrl: doctor.user.image,
      nextAvailableAtUnix: nextSlot ? Math.floor(nextSlot.getTime() / 1000) : null,
    };
  });
}

/** Full rebuild. Returns the number of documents submitted. */
export async function reindexDoctors(): Promise<number> {
  await ensureDoctorIndex();

  const documents = await buildDoctorDocuments();
  const client = getSearchClient();
  const index = client.index<DoctorDocument>(DOCTOR_INDEX);

  // Replace rather than merge, so a doctor who lost approval disappears.
  // Waiting matters: the caller (a seed or CLI run) exits immediately after,
  // and Meilisearch indexes asynchronously.
  const clearTask = await index.deleteAllDocuments();
  await client.tasks.waitForTask(clearTask.taskUid, { timeout: 30_000 });

  if (documents.length > 0) {
    const addTask = await index.addDocuments(documents, { primaryKey: "id" });
    await client.tasks.waitForTask(addTask.taskUid, { timeout: 60_000 });
  }

  logger.info({ count: documents.length }, "Doctor index rebuilt");
  return documents.length;
}

/**
 * Incremental upsert for a single doctor, called after profile, verification or
 * schedule changes. Failures are logged, never thrown: a stale search entry is
 * a much smaller problem than a failed approval.
 */
export async function syncDoctor(doctorId: string): Promise<void> {
  try {
    const documents = await buildDoctorDocuments();
    const document = documents.find((candidate) => candidate.id === doctorId);
    const index = getSearchClient().index<DoctorDocument>(DOCTOR_INDEX);

    if (!document) {
      // No longer approved — remove it from the directory.
      await index.deleteDocument(doctorId);
      return;
    }

    await index.addDocuments([document], { primaryKey: "id" });
  } catch (error) {
    logger.error({ err: error, doctorId }, "Search index sync failed");
  }
}
