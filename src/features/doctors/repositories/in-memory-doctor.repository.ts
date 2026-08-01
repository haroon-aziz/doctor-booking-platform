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
 * In-memory marketplace repository.
 *
 * This is not a stub: filtering, faceting, sorting and pagination are the real
 * algorithms, exercised by the unit tests and used verbatim for design review
 * (DEMO_MODE=true) before the Docker stack is running. Only the storage is
 * different — the behaviour the UI sees is identical to the Postgres driver.
 */

const HOURS = 60 * 60 * 1000;

/** Availability is expressed relative to "now" so the demo never goes stale. */
function inHours(hours: number): string {
  return new Date(Date.now() + hours * HOURS).toISOString();
}

interface DemoRecord extends Omit<DoctorProfile, "nextAvailableAt"> {
  nextAvailableInHours: number | null;
}

const DEMO_DOCTORS: DemoRecord[] = [
  {
    id: "doc_ayesha",
    slug: "ayesha-siddiqui-cardiology",
    fullName: "Ayesha Siddiqui",
    title: "Dr.",
    headline: "Interventional Cardiologist · FCPS, FACC",
    avatarUrl: null,
    gender: "FEMALE",
    specialties: ["Cardiology", "Internal Medicine"],
    primarySpecialty: "Cardiology",
    yearsOfExperience: 16,
    ratingAverage: 4.9,
    ratingCount: 412,
    city: "Karachi",
    clinicName: "Clifton Heart Clinic",
    hospitalName: "Aga Khan University Hospital",
    languages: ["Urdu", "English"],
    modes: ["IN_PERSON", "VIDEO"],
    fromFeeMinor: 350_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 4,
    bio: "I treat coronary artery disease, heart failure and arrhythmias, with a focus on minimally invasive angioplasty. I believe patients make better decisions when they genuinely understand their own scan results, so I set aside time in every consultation to walk through them.",
    education: [
      { degree: "MBBS", institution: "Dow Medical College", endYear: 2006 },
      { degree: "FCPS (Cardiology)", institution: "College of Physicians & Surgeons Pakistan", endYear: 2012 },
      { degree: "Interventional Fellowship", institution: "Royal Brompton Hospital, London", endYear: 2015 },
    ],
    certificates: [
      { name: "Fellow, American College of Cardiology", issuingBody: "ACC", issuedYear: 2017 },
      { name: "Advanced Cardiac Life Support", issuingBody: "AHA", issuedYear: 2023 },
    ],
    affiliations: [{ hospitalName: "Aga Khan University Hospital", position: "Consultant Cardiologist" }],
    clinicAddress: "Block 5, Clifton, Karachi",
    consultationDurationMinutes: 30,
    feesByMode: { IN_PERSON: 350_000, VIDEO: 300_000 },
    completedAppointments: 3_180,
    ratingBreakdown: { 5: 356, 4: 41, 3: 9, 2: 4, 1: 2 },
    reviews: [
      {
        id: "rev_1",
        authorName: "Hina R.",
        rating: 5,
        title: "Explained everything clearly",
        comment:
          "She went through my angiography images line by line and explained why surgery was not needed yet. First time a cardiologist has given me that much time.",
        createdAt: new Date(Date.now() - 6 * 24 * HOURS).toISOString(),
        doctorReply: "Thank you Hina — please keep up with the follow-up echo in six months.",
      },
      {
        id: "rev_2",
        authorName: "Anonymous",
        rating: 5,
        title: null,
        comment: "Punctual, and the video consultation was as thorough as an in-person visit.",
        createdAt: new Date(Date.now() - 20 * 24 * HOURS).toISOString(),
        doctorReply: null,
      },
    ],
  },
  {
    id: "doc_bilal",
    slug: "bilal-ahmed-dermatology",
    fullName: "Bilal Ahmed",
    title: "Dr.",
    headline: "Consultant Dermatologist · MBBS, MD",
    avatarUrl: null,
    gender: "MALE",
    specialties: ["Dermatology"],
    primarySpecialty: "Dermatology",
    yearsOfExperience: 9,
    ratingAverage: 4.7,
    ratingCount: 268,
    city: "Lahore",
    clinicName: "SkinWorks Gulberg",
    hospitalName: null,
    languages: ["Urdu", "English", "Punjabi"],
    modes: ["IN_PERSON", "VIDEO", "PHONE"],
    fromFeeMinor: 200_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 2,
    bio: "Medical and cosmetic dermatology, with a special interest in acne scarring and chronic eczema. Teledermatology works well for most skin complaints — send clear photographs and we can usually start treatment the same day.",
    education: [
      { degree: "MBBS", institution: "King Edward Medical University", endYear: 2013 },
      { degree: "MD (Dermatology)", institution: "University of Health Sciences", endYear: 2018 },
    ],
    certificates: [{ name: "Diploma in Dermoscopy", issuingBody: "IDS", issuedYear: 2021 }],
    affiliations: [],
    clinicAddress: "MM Alam Road, Gulberg III, Lahore",
    consultationDurationMinutes: 20,
    feesByMode: { IN_PERSON: 250_000, VIDEO: 200_000, PHONE: 150_000 },
    completedAppointments: 1_940,
    ratingBreakdown: { 5: 198, 4: 51, 3: 12, 2: 5, 1: 2 },
    reviews: [
      {
        id: "rev_3",
        authorName: "Usman T.",
        rating: 5,
        title: "Cleared up in three weeks",
        comment: "Sent photos through the app on Sunday night and had a prescription by Monday morning.",
        createdAt: new Date(Date.now() - 3 * 24 * HOURS).toISOString(),
        doctorReply: null,
      },
    ],
  },
  {
    id: "doc_fatima",
    slug: "fatima-noor-paediatrics",
    fullName: "Fatima Noor",
    title: "Dr.",
    headline: "Paediatrician & Neonatologist · FCPS",
    avatarUrl: null,
    gender: "FEMALE",
    specialties: ["Paediatrics", "Neonatology"],
    primarySpecialty: "Paediatrics",
    yearsOfExperience: 12,
    ratingAverage: 4.95,
    ratingCount: 531,
    city: "Islamabad",
    clinicName: "Little Steps Children's Clinic",
    hospitalName: "Shifa International Hospital",
    languages: ["Urdu", "English"],
    modes: ["IN_PERSON", "VIDEO"],
    fromFeeMinor: 250_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 26,
    bio: "Newborn care, childhood asthma, growth and vaccination schedules. Parents are welcome to bring a written list of questions — nothing is too small to ask about.",
    education: [
      { degree: "MBBS", institution: "Rawalpindi Medical College", endYear: 2010 },
      { degree: "FCPS (Paediatrics)", institution: "CPSP", endYear: 2016 },
    ],
    certificates: [
      { name: "Neonatal Resuscitation Program", issuingBody: "AAP", issuedYear: 2022 },
    ],
    affiliations: [{ hospitalName: "Shifa International Hospital", position: "Consultant Paediatrician" }],
    clinicAddress: "F-8 Markaz, Islamabad",
    consultationDurationMinutes: 25,
    feesByMode: { IN_PERSON: 300_000, VIDEO: 250_000 },
    completedAppointments: 4_620,
    ratingBreakdown: { 5: 489, 4: 33, 3: 6, 2: 2, 1: 1 },
    reviews: [
      {
        id: "rev_4",
        authorName: "Sadia K.",
        rating: 5,
        title: "Wonderful with anxious children",
        comment: "My four-year-old is terrified of doctors and she had him laughing within a minute.",
        createdAt: new Date(Date.now() - 11 * 24 * HOURS).toISOString(),
        doctorReply: "That is lovely to hear — see you at the next vaccination visit.",
      },
    ],
  },
  {
    id: "doc_hamza",
    slug: "hamza-raza-orthopaedics",
    fullName: "Hamza Raza",
    title: "Dr.",
    headline: "Orthopaedic Surgeon · Sports Injuries",
    avatarUrl: null,
    gender: "MALE",
    specialties: ["Orthopaedics"],
    primarySpecialty: "Orthopaedics",
    yearsOfExperience: 14,
    ratingAverage: 4.6,
    ratingCount: 187,
    city: "Karachi",
    clinicName: "Motion Orthopaedic Centre",
    hospitalName: "Liaquat National Hospital",
    languages: ["Urdu", "English", "Sindhi"],
    modes: ["IN_PERSON"],
    fromFeeMinor: 400_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 52,
    bio: "Arthroscopic knee and shoulder surgery, ligament reconstruction and fracture management. I work closely with physiotherapists so rehabilitation starts on day one rather than after the cast comes off.",
    education: [
      { degree: "MBBS", institution: "Sindh Medical College", endYear: 2008 },
      { degree: "FCPS (Orthopaedics)", institution: "CPSP", endYear: 2014 },
    ],
    certificates: [{ name: "AO Trauma Advanced Course", issuingBody: "AO Foundation", issuedYear: 2019 }],
    affiliations: [{ hospitalName: "Liaquat National Hospital", position: "Consultant Orthopaedic Surgeon" }],
    clinicAddress: "Shahrah-e-Faisal, Karachi",
    consultationDurationMinutes: 30,
    feesByMode: { IN_PERSON: 400_000 },
    completedAppointments: 2_310,
    ratingBreakdown: { 5: 126, 4: 43, 3: 12, 2: 4, 1: 2 },
    reviews: [],
  },
  {
    id: "doc_zara",
    slug: "zara-khan-psychiatry",
    fullName: "Zara Khan",
    title: "Dr.",
    headline: "Consultant Psychiatrist · Anxiety & Mood Disorders",
    avatarUrl: null,
    gender: "FEMALE",
    specialties: ["Psychiatry"],
    primarySpecialty: "Psychiatry",
    yearsOfExperience: 11,
    ratingAverage: 4.85,
    ratingCount: 302,
    city: "Lahore",
    clinicName: "Mind & Wellbeing Practice",
    hospitalName: null,
    languages: ["Urdu", "English"],
    modes: ["VIDEO", "PHONE", "IN_PERSON"],
    fromFeeMinor: 180_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 8,
    bio: "Depression, generalised anxiety, OCD and adult ADHD. Sessions are unhurried and confidential; medication is one option among several and never the only one we discuss.",
    education: [
      { degree: "MBBS", institution: "Allama Iqbal Medical College", endYear: 2011 },
      { degree: "MRCPsych", institution: "Royal College of Psychiatrists", endYear: 2018 },
    ],
    certificates: [{ name: "CBT Practitioner", issuingBody: "BABCP", issuedYear: 2020 }],
    affiliations: [],
    clinicAddress: "Model Town, Lahore",
    consultationDurationMinutes: 45,
    feesByMode: { VIDEO: 180_000, PHONE: 180_000, IN_PERSON: 220_000 },
    completedAppointments: 2_760,
    ratingBreakdown: { 5: 268, 4: 26, 3: 5, 2: 2, 1: 1 },
    reviews: [
      {
        id: "rev_5",
        authorName: "Anonymous",
        rating: 5,
        title: "Felt heard",
        comment: "The 45-minute slot makes a real difference. Never felt rushed out of the room.",
        createdAt: new Date(Date.now() - 30 * 24 * HOURS).toISOString(),
        doctorReply: null,
      },
    ],
  },
  {
    id: "doc_imran",
    slug: "imran-shah-general-medicine",
    fullName: "Imran Shah",
    title: "Dr.",
    headline: "General Physician · Diabetes & Hypertension",
    avatarUrl: null,
    gender: "MALE",
    specialties: ["Internal Medicine", "Endocrinology"],
    primarySpecialty: "Internal Medicine",
    yearsOfExperience: 7,
    ratingAverage: 4.4,
    ratingCount: 96,
    city: "Rawalpindi",
    clinicName: "CarePoint Family Clinic",
    hospitalName: null,
    languages: ["Urdu", "English", "Pashto"],
    modes: ["IN_PERSON", "VIDEO", "PHONE"],
    fromFeeMinor: 100_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 1,
    bio: "Everyday family medicine: diabetes control, blood pressure, thyroid and routine health screening. Same-day video slots most afternoons.",
    education: [{ degree: "MBBS", institution: "Rawalpindi Medical University", endYear: 2015 }],
    certificates: [{ name: "Certificate in Diabetes Care", issuingBody: "BIDE", issuedYear: 2021 }],
    affiliations: [],
    clinicAddress: "Satellite Town, Rawalpindi",
    consultationDurationMinutes: 15,
    feesByMode: { IN_PERSON: 120_000, VIDEO: 100_000, PHONE: 80_000 },
    completedAppointments: 1_120,
    ratingBreakdown: { 5: 58, 4: 27, 3: 8, 2: 2, 1: 1 },
    reviews: [],
  },
  {
    id: "doc_mehwish",
    slug: "mehwish-tariq-gynaecology",
    fullName: "Mehwish Tariq",
    title: "Dr.",
    headline: "Obstetrician & Gynaecologist · FCPS",
    avatarUrl: null,
    gender: "FEMALE",
    specialties: ["Gynaecology", "Obstetrics"],
    primarySpecialty: "Gynaecology",
    yearsOfExperience: 18,
    ratingAverage: 4.8,
    ratingCount: 447,
    city: "Karachi",
    clinicName: "Noor Women's Clinic",
    hospitalName: "South City Hospital",
    languages: ["Urdu", "English"],
    modes: ["IN_PERSON", "VIDEO"],
    fromFeeMinor: 280_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: false,
    nextAvailableInHours: null,
    bio: "Antenatal care, high-risk pregnancy and laparoscopic gynaecological surgery. Currently not accepting new patients while on a teaching rotation.",
    education: [
      { degree: "MBBS", institution: "Dow University of Health Sciences", endYear: 2004 },
      { degree: "FCPS (Obs & Gynae)", institution: "CPSP", endYear: 2011 },
    ],
    certificates: [{ name: "Advanced Laparoscopy", issuingBody: "RCOG", issuedYear: 2016 }],
    affiliations: [{ hospitalName: "South City Hospital", position: "Senior Consultant" }],
    clinicAddress: "Khayaban-e-Jami, DHA, Karachi",
    consultationDurationMinutes: 30,
    feesByMode: { IN_PERSON: 320_000, VIDEO: 280_000 },
    completedAppointments: 5_890,
    ratingBreakdown: { 5: 381, 4: 51, 3: 10, 2: 3, 1: 2 },
    reviews: [],
  },
  {
    id: "doc_saad",
    slug: "saad-mahmood-neurology",
    fullName: "Saad Mahmood",
    title: "Dr.",
    headline: "Neurologist · Epilepsy & Headache Medicine",
    avatarUrl: null,
    gender: "MALE",
    specialties: ["Neurology"],
    primarySpecialty: "Neurology",
    yearsOfExperience: 13,
    ratingAverage: 4.65,
    ratingCount: 154,
    city: "Islamabad",
    clinicName: "Neuro Care Islamabad",
    hospitalName: "PIMS",
    languages: ["Urdu", "English"],
    modes: ["IN_PERSON", "VIDEO"],
    fromFeeMinor: 300_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 72,
    bio: "Epilepsy, migraine, stroke follow-up and peripheral neuropathy. Please bring any previous MRI or EEG reports to the first appointment.",
    education: [
      { degree: "MBBS", institution: "Quaid-e-Azam Medical College", endYear: 2009 },
      { degree: "FCPS (Neurology)", institution: "CPSP", endYear: 2015 },
    ],
    certificates: [],
    affiliations: [{ hospitalName: "PIMS", position: "Assistant Professor of Neurology" }],
    clinicAddress: "G-8 Markaz, Islamabad",
    consultationDurationMinutes: 30,
    feesByMode: { IN_PERSON: 350_000, VIDEO: 300_000 },
    completedAppointments: 1_640,
    ratingBreakdown: { 5: 98, 4: 41, 3: 10, 2: 3, 1: 2 },
    reviews: [],
  },
  {
    id: "doc_nida",
    slug: "nida-aslam-nutrition",
    fullName: "Nida Aslam",
    title: "Dr.",
    headline: "Clinical Nutritionist · Weight & Metabolic Health",
    avatarUrl: null,
    gender: "FEMALE",
    specialties: ["Nutrition"],
    primarySpecialty: "Nutrition",
    yearsOfExperience: 6,
    ratingAverage: 4.5,
    ratingCount: 78,
    city: "Faisalabad",
    clinicName: "Balance Nutrition Studio",
    hospitalName: null,
    languages: ["Urdu", "Punjabi", "English"],
    modes: ["VIDEO", "PHONE"],
    fromFeeMinor: 90_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 5,
    bio: "Evidence-based plans for PCOS, insulin resistance and sustainable weight change. No crash diets and no supplements you do not need.",
    education: [{ degree: "MSc Clinical Nutrition", institution: "GC University Faisalabad", endYear: 2017 }],
    certificates: [{ name: "Certified Diabetes Educator", issuingBody: "IDF", issuedYear: 2022 }],
    affiliations: [],
    clinicAddress: null,
    consultationDurationMinutes: 40,
    feesByMode: { VIDEO: 90_000, PHONE: 70_000 },
    completedAppointments: 690,
    ratingBreakdown: { 5: 47, 4: 22, 3: 6, 2: 2, 1: 1 },
    reviews: [],
  },
  {
    id: "doc_kamran",
    slug: "kamran-yousaf-ent",
    fullName: "Kamran Yousaf",
    title: "Dr.",
    headline: "ENT Surgeon · Sinus & Hearing Disorders",
    avatarUrl: null,
    gender: "MALE",
    specialties: ["ENT"],
    primarySpecialty: "ENT",
    yearsOfExperience: 10,
    ratingAverage: 4.3,
    ratingCount: 64,
    city: "Peshawar",
    clinicName: "Clear ENT Clinic",
    hospitalName: "Lady Reading Hospital",
    languages: ["Pashto", "Urdu", "English"],
    modes: ["IN_PERSON", "VIDEO"],
    fromFeeMinor: 150_000,
    currency: "PKR",
    isVerified: true,
    isAcceptingPatients: true,
    nextAvailableInHours: 14,
    bio: "Chronic sinusitis, tonsillectomy, hearing assessment and vertigo. Endoscopic sinus surgery performed at Lady Reading Hospital.",
    education: [
      { degree: "MBBS", institution: "Khyber Medical College", endYear: 2012 },
      { degree: "FCPS (ENT)", institution: "CPSP", endYear: 2018 },
    ],
    certificates: [],
    affiliations: [{ hospitalName: "Lady Reading Hospital", position: "Consultant ENT Surgeon" }],
    clinicAddress: "University Road, Peshawar",
    consultationDurationMinutes: 20,
    feesByMode: { IN_PERSON: 180_000, VIDEO: 150_000 },
    completedAppointments: 880,
    ratingBreakdown: { 5: 34, 4: 20, 3: 7, 2: 2, 1: 1 },
    reviews: [],
  },
];

function toSummary(record: DemoRecord): DoctorSummary {
  const { nextAvailableInHours, ...rest } = record;
  return {
    ...rest,
    nextAvailableAt: nextAvailableInHours === null ? null : inHours(nextAvailableInHours),
  };
}

function buildFacet(
  records: DemoRecord[],
  pick: (record: DemoRecord) => string[],
  label: (value: string) => string = (value) => value,
): FacetBucket[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const value of pick(record)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const MODE_LABELS: Record<ConsultationMode, string> = {
  IN_PERSON: "In person",
  VIDEO: "Video",
  PHONE: "Phone",
};

export class InMemoryDoctorRepository implements DoctorRepository {
  private readonly records: DemoRecord[];

  constructor(records: DemoRecord[] = DEMO_DOCTORS) {
    this.records = records;
  }

  async search(filters: DoctorSearchFilters): Promise<DoctorSearchResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 10));

    const matches = this.records.filter((record) => this.matches(record, filters));
    const sorted = this.sort(matches, filters.sort ?? "relevance");

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;

    return {
      doctors: sorted.slice(start, start + pageSize).map(toSummary),
      total,
      page,
      pageSize,
      totalPages,
      // Facets are computed over the matched set so counts reflect the query.
      facets: {
        cities: buildFacet(matches, (record) => [record.city]),
        specialties: buildFacet(matches, (record) => record.specialties),
        languages: buildFacet(matches, (record) => record.languages),
        modes: buildFacet(
          matches,
          (record) => record.modes,
          (value) => MODE_LABELS[value as ConsultationMode] ?? value,
        ),
      },
    };
  }

  async findBySlug(slug: string): Promise<DoctorProfile | null> {
    const record = this.records.find((candidate) => candidate.slug === slug);
    if (!record) return null;
    return { ...toSummary(record), ...this.profileOf(record) };
  }

  async findFeatured(limit: number): Promise<DoctorSummary[]> {
    return [...this.records]
      .filter((record) => record.isAcceptingPatients)
      .sort((a, b) => b.ratingAverage * Math.log1p(b.ratingCount) - a.ratingAverage * Math.log1p(a.ratingCount))
      .slice(0, limit)
      .map(toSummary);
  }

  async listCities(): Promise<string[]> {
    return [...new Set(this.records.map((record) => record.city))].sort();
  }

  private profileOf(record: DemoRecord): Omit<DoctorProfile, keyof DoctorSummary> {
    return {
      bio: record.bio,
      education: record.education,
      certificates: record.certificates,
      affiliations: record.affiliations,
      clinicAddress: record.clinicAddress,
      consultationDurationMinutes: record.consultationDurationMinutes,
      feesByMode: record.feesByMode,
      completedAppointments: record.completedAppointments,
      reviews: record.reviews,
      ratingBreakdown: record.ratingBreakdown,
    };
  }

  private matches(record: DemoRecord, filters: DoctorSearchFilters): boolean {
    if (filters.query) {
      const haystack = [
        record.fullName,
        record.headline,
        record.primarySpecialty,
        ...record.specialties,
        record.city,
        record.clinicName ?? "",
        record.hospitalName ?? "",
      ]
        .join(" ")
        .toLowerCase();

      // Every whitespace-separated term must appear somewhere (AND semantics).
      const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }

    if (filters.city && record.city !== filters.city) return false;
    if (filters.specialty && !record.specialties.includes(filters.specialty)) return false;
    if (filters.hospital && record.hospitalName !== filters.hospital) return false;
    if (filters.language && !record.languages.includes(filters.language)) return false;
    if (filters.gender && record.gender !== filters.gender) return false;
    if (filters.mode && !record.modes.includes(filters.mode)) return false;
    if (filters.minRating != null && record.ratingAverage < filters.minRating) return false;
    if (filters.minExperience != null && record.yearsOfExperience < filters.minExperience) return false;
    if (filters.maxFeeMinor != null && record.fromFeeMinor > filters.maxFeeMinor) return false;

    if (filters.availableToday) {
      if (record.nextAvailableInHours === null || record.nextAvailableInHours > 24) return false;
    }

    return true;
  }

  private sort(records: DemoRecord[], key: NonNullable<DoctorSearchFilters["sort"]>): DemoRecord[] {
    const sorted = [...records];
    const availability = (record: DemoRecord) => record.nextAvailableInHours ?? Number.MAX_SAFE_INTEGER;

    switch (key) {
      case "rating_desc":
        return sorted.sort((a, b) => b.ratingAverage - a.ratingAverage || b.ratingCount - a.ratingCount);
      case "experience_desc":
        return sorted.sort((a, b) => b.yearsOfExperience - a.yearsOfExperience);
      case "fee_asc":
        return sorted.sort((a, b) => a.fromFeeMinor - b.fromFeeMinor);
      case "fee_desc":
        return sorted.sort((a, b) => b.fromFeeMinor - a.fromFeeMinor);
      case "earliest_available":
        return sorted.sort((a, b) => availability(a) - availability(b));
      case "relevance":
      default:
        // Relevance blends rating confidence with how soon the patient can be
        // seen — a marginally better-rated doctor three weeks out is not the
        // most useful first result.
        return sorted.sort((a, b) => this.relevance(b) - this.relevance(a));
    }
  }

  private relevance(record: DemoRecord): number {
    const ratingScore = record.ratingAverage * Math.log1p(record.ratingCount);
    const availabilityScore = record.nextAvailableInHours === null ? 0 : 12 / (1 + record.nextAvailableInHours / 24);
    const acceptingBonus = record.isAcceptingPatients ? 3 : 0;
    return ratingScore + availabilityScore + acceptingBonus;
  }
}

export const demoDoctorCount = DEMO_DOCTORS.length;

export interface DemoSchedule {
  /** 0 = Sunday .. 6 = Saturday, in the doctor's timezone. */
  workDays: number[];
  startMinute: number;
  endMinute: number;
  breakStartMinute: number | null;
  breakEndMinute: number | null;
}

/**
 * Weekly working hours for the demo directory. Kept beside the doctors they
 * describe so the in-memory slot repository can expand them through the same
 * generator the production path uses.
 */
export const DEMO_SCHEDULES: Record<string, DemoSchedule> = {
  doc_ayesha: { workDays: [1, 2, 3, 4, 6], startMinute: 540, endMinute: 840, breakStartMinute: 660, breakEndMinute: 690 },
  doc_bilal: { workDays: [0, 1, 2, 3, 4], startMinute: 600, endMinute: 1020, breakStartMinute: 780, breakEndMinute: 840 },
  doc_fatima: { workDays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 900, breakStartMinute: 720, breakEndMinute: 750 },
  doc_hamza: { workDays: [1, 3, 5], startMinute: 900, endMinute: 1200, breakStartMinute: null, breakEndMinute: null },
  doc_zara: { workDays: [0, 2, 4, 6], startMinute: 660, endMinute: 1140, breakStartMinute: 840, breakEndMinute: 900 },
  doc_imran: { workDays: [0, 1, 2, 3, 4, 5, 6], startMinute: 480, endMinute: 1200, breakStartMinute: 780, breakEndMinute: 840 },
  doc_mehwish: { workDays: [1, 3], startMinute: 600, endMinute: 840, breakStartMinute: null, breakEndMinute: null },
  doc_saad: { workDays: [2, 4], startMinute: 540, endMinute: 780, breakStartMinute: null, breakEndMinute: null },
  doc_nida: { workDays: [0, 1, 2, 3, 4], startMinute: 600, endMinute: 960, breakStartMinute: null, breakEndMinute: null },
  doc_kamran: { workDays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 840, breakStartMinute: null, breakEndMinute: null },
};

/** Lookup used by the in-memory slot repository. */
export function findDemoDoctor(doctorId: string) {
  return DEMO_DOCTORS.find((record) => record.id === doctorId) ?? null;
}
