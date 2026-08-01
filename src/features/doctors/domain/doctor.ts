import type { ConsultationMode, Gender } from "@/generated/prisma/enums";

/**
 * Read models for the marketplace.
 *
 * These are deliberately not Prisma row types: the search grid needs a flat,
 * serialisable shape it can hand straight to a client component, and decoupling
 * it from the schema means a column rename does not ripple into the UI.
 */

export interface DoctorSummary {
  id: string;
  slug: string;
  fullName: string;
  title: string;
  headline: string;
  avatarUrl: string | null;
  gender: Gender;
  specialties: string[];
  primarySpecialty: string;
  yearsOfExperience: number;
  ratingAverage: number;
  ratingCount: number;
  city: string;
  clinicName: string | null;
  hospitalName: string | null;
  languages: string[];
  modes: ConsultationMode[];
  /** Lowest fee across the modes this doctor supports, in minor units. */
  fromFeeMinor: number;
  currency: string;
  isVerified: boolean;
  isAcceptingPatients: boolean;
  /** ISO instant of the earliest bookable slot, when one exists. */
  nextAvailableAt: string | null;
}

export interface DoctorEducation {
  degree: string;
  institution: string;
  endYear: number | null;
}

export interface DoctorReviewSummary {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  comment: string;
  createdAt: string;
  doctorReply: string | null;
}

export interface DoctorProfile extends DoctorSummary {
  bio: string;
  education: DoctorEducation[];
  certificates: { name: string; issuingBody: string; issuedYear: number }[];
  affiliations: { hospitalName: string; position: string }[];
  clinicAddress: string | null;
  consultationDurationMinutes: number;
  feesByMode: Partial<Record<ConsultationMode, number>>;
  completedAppointments: number;
  reviews: DoctorReviewSummary[];
  ratingBreakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

export type DoctorSortKey =
  | "relevance"
  | "rating_desc"
  | "experience_desc"
  | "fee_asc"
  | "fee_desc"
  | "earliest_available";

export interface DoctorSearchFilters {
  query?: string;
  city?: string;
  specialty?: string;
  hospital?: string;
  language?: string;
  gender?: Gender;
  mode?: ConsultationMode;
  minRating?: number;
  minExperience?: number;
  maxFeeMinor?: number;
  availableToday?: boolean;
  sort?: DoctorSortKey;
  page?: number;
  pageSize?: number;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export interface DoctorSearchResult {
  doctors: DoctorSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: {
    cities: FacetBucket[];
    specialties: FacetBucket[];
    languages: FacetBucket[];
    modes: FacetBucket[];
  };
}
