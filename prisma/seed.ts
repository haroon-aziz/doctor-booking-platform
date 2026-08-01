/**
 * Env comes from Node's `--env-file-if-exists` flag in the npm script. A
 * `dotenv.config()` call here would run after the static imports below are
 * evaluated, which is too late for `@/lib/config/env`.
 */
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/db/prisma";
import { generateSlots, type AvailabilityRuleInput } from "@/features/booking/services/slot-generator";
import { SYMPTOM_RULES } from "@/features/ai/data/symptom-rules";
import { appointmentReference, invoiceNumber, slugify } from "@/lib/utils/identifiers";
import type { ConsultationMode, Gender } from "@/generated/prisma/enums";

/**
 * Development seed.
 *
 * Produces a directory that is realistic enough to exercise every screen:
 * verified and pending doctors, a doctor on vacation, one not accepting
 * patients, past and upcoming appointments, published and pending reviews,
 * and a fully populated availability calendar built by the real slot
 * generator (never hand-written rows, so the seed cannot drift from the
 * booking engine's behaviour).
 *
 * Idempotent: it truncates the tables it owns before inserting.
 */

const DEFAULT_PASSWORD = "Passw0rd!23";
const TZ = "Asia/Karachi";
const SLOT_HORIZON_DAYS = 21;

const SPECIALTIES = [
  ["Cardiology", "Heart and circulatory conditions"],
  ["Dermatology", "Skin, hair and nail conditions"],
  ["Paediatrics", "Medical care for infants and children"],
  ["Neonatology", "Care of newborn infants"],
  ["Neurology", "Brain, spine and nervous system"],
  ["Orthopaedics", "Bones, joints and musculoskeletal injuries"],
  ["Psychiatry", "Mental health and behavioural conditions"],
  ["ENT", "Ear, nose and throat"],
  ["Internal Medicine", "General adult medicine"],
  ["Endocrinology", "Hormonal and metabolic disorders"],
  ["Gynaecology", "Women's reproductive health"],
  ["Obstetrics", "Pregnancy and childbirth"],
  ["Nutrition", "Diet and metabolic health"],
  ["Ophthalmology", "Eye and vision care"],
  ["Urology", "Urinary tract and male reproductive health"],
  ["Gastroenterology", "Digestive system disorders"],
  ["Pulmonology", "Lungs and respiratory system"],
  ["Rheumatology", "Autoimmune and joint diseases"],
] as const;

const LANGUAGES = [
  ["ur", "Urdu", "اردو"],
  ["en", "English", "English"],
  ["pa", "Punjabi", "پنجابی"],
  ["sd", "Sindhi", "سنڌي"],
  ["ps", "Pashto", "پښتو"],
  ["bal", "Balochi", "بلوچی"],
] as const;

const HOSPITALS = [
  ["Aga Khan University Hospital", "Stadium Road", "Karachi"],
  ["Liaquat National Hospital", "National Stadium Road", "Karachi"],
  ["South City Hospital", "Khayaban-e-Jami, DHA", "Karachi"],
  ["Shaukat Khanum Memorial", "7-A Block R-3, Johar Town", "Lahore"],
  ["Shifa International Hospital", "Pitras Bukhari Road, H-8/4", "Islamabad"],
  ["Pakistan Institute of Medical Sciences", "G-8/3", "Islamabad"],
  ["Lady Reading Hospital", "Soikarno Road", "Peshawar"],
] as const;

interface DoctorSeed {
  firstName: string;
  lastName: string;
  email: string;
  gender: Gender;
  specialties: string[];
  primarySpecialty: string;
  experience: number;
  city: string;
  clinicName: string;
  clinicAddress: string;
  hospital: string | null;
  languages: string[];
  bio: string;
  fees: Partial<Record<ConsultationMode, number>>;
  durationMinutes: number;
  rating: number;
  ratingCount: number;
  verification: "APPROVED" | "PENDING" | "UNDER_REVIEW";
  accepting: boolean;
  vacation: boolean;
  education: [string, string, number][];
  certificates: [string, string, number][];
  workDays: number[];
  workStart: number;
  workEnd: number;
  breakStart: number | null;
  breakEnd: number | null;
}

const DOCTORS: DoctorSeed[] = [
  {
    firstName: "Ayesha", lastName: "Siddiqui", email: "ayesha.siddiqui@medibook.test", gender: "FEMALE",
    specialties: ["Cardiology", "Internal Medicine"], primarySpecialty: "Cardiology", experience: 16,
    city: "Karachi", clinicName: "Clifton Heart Clinic", clinicAddress: "Block 5, Clifton",
    hospital: "Aga Khan University Hospital", languages: ["Urdu", "English"],
    bio: "I treat coronary artery disease, heart failure and arrhythmias, with a focus on minimally invasive angioplasty. Patients make better decisions when they genuinely understand their own scan results, so I set aside time in every consultation to walk through them.",
    fees: { IN_PERSON: 350_000, VIDEO: 300_000 }, durationMinutes: 30, rating: 4.9, ratingCount: 412,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "Dow Medical College", 2006], ["FCPS (Cardiology)", "College of Physicians & Surgeons Pakistan", 2012]],
    certificates: [["Fellow, American College of Cardiology", "ACC", 2017], ["Advanced Cardiac Life Support", "AHA", 2023]],
    workDays: [1, 2, 3, 4, 6], workStart: 9 * 60, workEnd: 14 * 60, breakStart: 11 * 60, breakEnd: 11 * 60 + 30,
  },
  {
    firstName: "Bilal", lastName: "Ahmed", email: "bilal.ahmed@medibook.test", gender: "MALE",
    specialties: ["Dermatology"], primarySpecialty: "Dermatology", experience: 9,
    city: "Lahore", clinicName: "SkinWorks Gulberg", clinicAddress: "MM Alam Road, Gulberg III",
    hospital: null, languages: ["Urdu", "English", "Punjabi"],
    bio: "Medical and cosmetic dermatology, with a special interest in acne scarring and chronic eczema. Teledermatology works well for most skin complaints — send clear photographs and we can usually start treatment the same day.",
    fees: { IN_PERSON: 250_000, VIDEO: 200_000, PHONE: 150_000 }, durationMinutes: 20, rating: 4.7, ratingCount: 268,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "King Edward Medical University", 2013], ["MD (Dermatology)", "University of Health Sciences", 2018]],
    certificates: [["Diploma in Dermoscopy", "International Dermoscopy Society", 2021]],
    workDays: [0, 1, 2, 3, 4], workStart: 10 * 60, workEnd: 17 * 60, breakStart: 13 * 60, breakEnd: 14 * 60,
  },
  {
    firstName: "Fatima", lastName: "Noor", email: "fatima.noor@medibook.test", gender: "FEMALE",
    specialties: ["Paediatrics", "Neonatology"], primarySpecialty: "Paediatrics", experience: 12,
    city: "Islamabad", clinicName: "Little Steps Children's Clinic", clinicAddress: "F-8 Markaz",
    hospital: "Shifa International Hospital", languages: ["Urdu", "English"],
    bio: "Newborn care, childhood asthma, growth and vaccination schedules. Parents are welcome to bring a written list of questions — nothing is too small to ask about.",
    fees: { IN_PERSON: 300_000, VIDEO: 250_000 }, durationMinutes: 25, rating: 4.95, ratingCount: 531,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "Rawalpindi Medical College", 2010], ["FCPS (Paediatrics)", "CPSP", 2016]],
    certificates: [["Neonatal Resuscitation Program", "American Academy of Pediatrics", 2022]],
    workDays: [1, 2, 3, 4, 5], workStart: 9 * 60, workEnd: 15 * 60, breakStart: 12 * 60, breakEnd: 12 * 60 + 30,
  },
  {
    firstName: "Hamza", lastName: "Raza", email: "hamza.raza@medibook.test", gender: "MALE",
    specialties: ["Orthopaedics"], primarySpecialty: "Orthopaedics", experience: 14,
    city: "Karachi", clinicName: "Motion Orthopaedic Centre", clinicAddress: "Shahrah-e-Faisal",
    hospital: "Liaquat National Hospital", languages: ["Urdu", "English", "Sindhi"],
    bio: "Arthroscopic knee and shoulder surgery, ligament reconstruction and fracture management. I work closely with physiotherapists so rehabilitation starts on day one rather than after the cast comes off.",
    fees: { IN_PERSON: 400_000 }, durationMinutes: 30, rating: 4.6, ratingCount: 187,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "Sindh Medical College", 2008], ["FCPS (Orthopaedics)", "CPSP", 2014]],
    certificates: [["AO Trauma Advanced Course", "AO Foundation", 2019]],
    workDays: [1, 3, 5], workStart: 15 * 60, workEnd: 20 * 60, breakStart: null, breakEnd: null,
  },
  {
    firstName: "Zara", lastName: "Khan", email: "zara.khan@medibook.test", gender: "FEMALE",
    specialties: ["Psychiatry"], primarySpecialty: "Psychiatry", experience: 11,
    city: "Lahore", clinicName: "Mind & Wellbeing Practice", clinicAddress: "Model Town",
    hospital: null, languages: ["Urdu", "English"],
    bio: "Depression, generalised anxiety, OCD and adult ADHD. Sessions are unhurried and confidential; medication is one option among several and never the only one we discuss.",
    fees: { VIDEO: 180_000, PHONE: 180_000, IN_PERSON: 220_000 }, durationMinutes: 45, rating: 4.85, ratingCount: 302,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "Allama Iqbal Medical College", 2011], ["MRCPsych", "Royal College of Psychiatrists", 2018]],
    certificates: [["CBT Practitioner", "BABCP", 2020]],
    workDays: [0, 2, 4, 6], workStart: 11 * 60, workEnd: 19 * 60, breakStart: 14 * 60, breakEnd: 15 * 60,
  },
  {
    firstName: "Imran", lastName: "Shah", email: "imran.shah@medibook.test", gender: "MALE",
    specialties: ["Internal Medicine", "Endocrinology"], primarySpecialty: "Internal Medicine", experience: 7,
    city: "Rawalpindi", clinicName: "CarePoint Family Clinic", clinicAddress: "Satellite Town",
    hospital: null, languages: ["Urdu", "English", "Pashto"],
    bio: "Everyday family medicine: diabetes control, blood pressure, thyroid and routine health screening. Same-day video slots most afternoons.",
    fees: { IN_PERSON: 120_000, VIDEO: 100_000, PHONE: 80_000 }, durationMinutes: 15, rating: 4.4, ratingCount: 96,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "Rawalpindi Medical University", 2015]],
    certificates: [["Certificate in Diabetes Care", "BIDE", 2021]],
    workDays: [0, 1, 2, 3, 4, 5, 6], workStart: 8 * 60, workEnd: 20 * 60, breakStart: 13 * 60, breakEnd: 14 * 60,
  },
  {
    firstName: "Mehwish", lastName: "Tariq", email: "mehwish.tariq@medibook.test", gender: "FEMALE",
    specialties: ["Gynaecology", "Obstetrics"], primarySpecialty: "Gynaecology", experience: 18,
    city: "Karachi", clinicName: "Noor Women's Clinic", clinicAddress: "Khayaban-e-Jami, DHA",
    hospital: "South City Hospital", languages: ["Urdu", "English"],
    bio: "Antenatal care, high-risk pregnancy and laparoscopic gynaecological surgery. Currently not accepting new patients while on a teaching rotation.",
    fees: { IN_PERSON: 320_000, VIDEO: 280_000 }, durationMinutes: 30, rating: 4.8, ratingCount: 447,
    verification: "APPROVED", accepting: false, vacation: false,
    education: [["MBBS", "Dow University of Health Sciences", 2004], ["FCPS (Obs & Gynae)", "CPSP", 2011]],
    certificates: [["Advanced Laparoscopy", "RCOG", 2016]],
    workDays: [1, 3], workStart: 10 * 60, workEnd: 14 * 60, breakStart: null, breakEnd: null,
  },
  {
    firstName: "Saad", lastName: "Mahmood", email: "saad.mahmood@medibook.test", gender: "MALE",
    specialties: ["Neurology"], primarySpecialty: "Neurology", experience: 13,
    city: "Islamabad", clinicName: "Neuro Care Islamabad", clinicAddress: "G-8 Markaz",
    hospital: "Pakistan Institute of Medical Sciences", languages: ["Urdu", "English"],
    bio: "Epilepsy, migraine, stroke follow-up and peripheral neuropathy. Please bring any previous MRI or EEG reports to the first appointment.",
    fees: { IN_PERSON: 350_000, VIDEO: 300_000 }, durationMinutes: 30, rating: 4.65, ratingCount: 154,
    verification: "APPROVED", accepting: true, vacation: true,
    education: [["MBBS", "Quaid-e-Azam Medical College", 2009], ["FCPS (Neurology)", "CPSP", 2015]],
    certificates: [],
    workDays: [2, 4], workStart: 9 * 60, workEnd: 13 * 60, breakStart: null, breakEnd: null,
  },
  {
    firstName: "Nida", lastName: "Aslam", email: "nida.aslam@medibook.test", gender: "FEMALE",
    specialties: ["Nutrition"], primarySpecialty: "Nutrition", experience: 6,
    city: "Faisalabad", clinicName: "Balance Nutrition Studio", clinicAddress: "Kohinoor City",
    hospital: null, languages: ["Urdu", "Punjabi", "English"],
    bio: "Evidence-based plans for PCOS, insulin resistance and sustainable weight change. No crash diets and no supplements you do not need.",
    fees: { VIDEO: 90_000, PHONE: 70_000 }, durationMinutes: 40, rating: 4.5, ratingCount: 78,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MSc Clinical Nutrition", "GC University Faisalabad", 2017]],
    certificates: [["Certified Diabetes Educator", "IDF", 2022]],
    workDays: [0, 1, 2, 3, 4], workStart: 10 * 60, workEnd: 16 * 60, breakStart: null, breakEnd: null,
  },
  {
    firstName: "Kamran", lastName: "Yousaf", email: "kamran.yousaf@medibook.test", gender: "MALE",
    specialties: ["ENT"], primarySpecialty: "ENT", experience: 10,
    city: "Peshawar", clinicName: "Clear ENT Clinic", clinicAddress: "University Road",
    hospital: "Lady Reading Hospital", languages: ["Pashto", "Urdu", "English"],
    bio: "Chronic sinusitis, tonsillectomy, hearing assessment and vertigo. Endoscopic sinus surgery performed at Lady Reading Hospital.",
    fees: { IN_PERSON: 180_000, VIDEO: 150_000 }, durationMinutes: 20, rating: 4.3, ratingCount: 64,
    verification: "APPROVED", accepting: true, vacation: false,
    education: [["MBBS", "Khyber Medical College", 2012], ["FCPS (ENT)", "CPSP", 2018]],
    certificates: [],
    workDays: [1, 2, 3, 4, 5], workStart: 9 * 60, workEnd: 14 * 60, breakStart: null, breakEnd: null,
  },
  {
    firstName: "Owais", lastName: "Malik", email: "owais.malik@medibook.test", gender: "MALE",
    specialties: ["Pulmonology"], primarySpecialty: "Pulmonology", experience: 8,
    city: "Lahore", clinicName: "Breathe Well Chest Clinic", clinicAddress: "Johar Town",
    hospital: "Shaukat Khanum Memorial", languages: ["Urdu", "English", "Punjabi"],
    bio: "Asthma, COPD, sleep apnoea and chronic cough. Awaiting credential verification.",
    fees: { IN_PERSON: 220_000, VIDEO: 190_000 }, durationMinutes: 25, rating: 0, ratingCount: 0,
    verification: "UNDER_REVIEW", accepting: true, vacation: false,
    education: [["MBBS", "Fatima Jinnah Medical University", 2014], ["FCPS (Pulmonology)", "CPSP", 2020]],
    certificates: [],
    workDays: [1, 3, 5], workStart: 9 * 60, workEnd: 13 * 60, breakStart: null, breakEnd: null,
  },
  {
    firstName: "Sana", lastName: "Iqbal", email: "sana.iqbal@medibook.test", gender: "FEMALE",
    specialties: ["Ophthalmology"], primarySpecialty: "Ophthalmology", experience: 5,
    city: "Multan", clinicName: "Vision Plus Eye Care", clinicAddress: "Gulgasht Colony",
    hospital: null, languages: ["Urdu", "English"],
    bio: "Cataract assessment, refractive error and diabetic retinopathy screening. Application submitted, pending document review.",
    fees: { IN_PERSON: 160_000 }, durationMinutes: 20, rating: 0, ratingCount: 0,
    verification: "PENDING", accepting: true, vacation: false,
    education: [["MBBS", "Nishtar Medical University", 2018]],
    certificates: [],
    workDays: [1, 2, 3, 4], workStart: 10 * 60, workEnd: 14 * 60, breakStart: null, breakEnd: null,
  },
];

const PATIENTS = [
  { firstName: "Hina", lastName: "Rauf", email: "hina.rauf@medibook.test", gender: "FEMALE" as Gender, city: "Karachi" },
  { firstName: "Usman", lastName: "Tariq", email: "usman.tariq@medibook.test", gender: "MALE" as Gender, city: "Lahore" },
  { firstName: "Sadia", lastName: "Kamal", email: "sadia.kamal@medibook.test", gender: "FEMALE" as Gender, city: "Islamabad" },
];

const SYSTEM_SETTINGS: [string, string, "STRING" | "NUMBER" | "BOOLEAN", string, string, boolean][] = [
  ["platform.commission_percentage", "12", "NUMBER", "payments", "Platform commission (%)", false],
  ["booking.cancellation_window_hours", "24", "NUMBER", "booking", "Free cancellation window (hours)", true],
  ["booking.max_advance_days", "90", "NUMBER", "booking", "How far ahead patients may book (days)", true],
  ["booking.slot_hold_minutes", "10", "NUMBER", "booking", "Checkout slot hold (minutes)", true],
  ["reviews.require_moderation", "true", "BOOLEAN", "reviews", "Hold new reviews for moderation", false],
  ["reviews.min_days_after_appointment", "0", "NUMBER", "reviews", "Delay before a review may be left (days)", false],
  ["support.email", "support@medibook.test", "STRING", "general", "Support contact email", true],
  ["ai.disclaimer", "This assistant provides general information only and is not a medical diagnosis.", "STRING", "ai", "AI assistant disclaimer", true],
];

async function reset(): Promise<void> {
  // Ordered so every child is removed before its parent.
  await prisma.$transaction([
    prisma.aiMessage.deleteMany(),
    prisma.aiConversation.deleteMany(),
    prisma.symptomCheck.deleteMany(),
    prisma.symptomRule.deleteMany(),
    prisma.ticketMessage.deleteMany(),
    prisma.supportTicket.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.adminLog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.invoiceLineItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.couponRedemption.deleteMany(),
    prisma.prescriptionItem.deleteMany(),
    prisma.prescription.deleteMany(),
    prisma.medicalRecord.deleteMany(),
    prisma.review.deleteMany(),
    prisma.videoSession.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.appointmentSlot.deleteMany(),
    prisma.availabilityException.deleteMany(),
    prisma.availabilityRule.deleteMany(),
    prisma.verificationDocument.deleteMany(),
    prisma.doctorVerification.deleteMany(),
    prisma.certificate.deleteMany(),
    prisma.education.deleteMany(),
    prisma.hospitalAffiliation.deleteMany(),
    prisma.doctorClinic.deleteMany(),
    prisma.doctorLanguage.deleteMany(),
    prisma.doctorSpecialty.deleteMany(),
    prisma.savedDoctor.deleteMany(),
    prisma.doctor.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.clinic.deleteMany(),
    prisma.hospital.deleteMany(),
    prisma.specialty.deleteMany(),
    prisma.language.deleteMany(),
    prisma.coupon.deleteMany(),
    prisma.storedFile.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.user.deleteMany(),
    prisma.systemSetting.deleteMany(),
  ]);
}

async function createUser(input: {
  name: string;
  email: string;
  role: "PATIENT" | "DOCTOR" | "ADMIN" | "SUPER_ADMIN";
  passwordHash: string;
  phone: string;
}) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      emailVerified: true,
      phone: input.phone,
      phoneVerified: true,
      role: input.role,
      status: "ACTIVE",
      timezone: TZ,
      accounts: {
        create: {
          providerId: "credential",
          accountId: input.email,
          password: input.passwordHash,
        },
      },
    },
  });
}

async function main(): Promise<void> {
  console.log("Resetting database…");
  await reset();

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  // Pad rather than truncate: slicing a fixed-width number would drop the
  // digits that vary, producing duplicates against the unique `phone` index.
  let phoneCounter = 1;
  const nextPhone = () => `+9230${String(phoneCounter++).padStart(8, "0")}`;

  console.log("Seeding reference data…");
  const specialties = new Map<string, string>();
  for (const [index, [name, description]] of SPECIALTIES.entries()) {
    const row = await prisma.specialty.create({
      data: { name, slug: slugify(name, false), description, displayOrder: index },
    });
    specialties.set(name, row.id);
  }

  const languages = new Map<string, string>();
  for (const [code, name, nativeName] of LANGUAGES) {
    const row = await prisma.language.create({ data: { code, name, nativeName } });
    languages.set(name, row.id);
  }

  const hospitals = new Map<string, string>();
  for (const [name, addressLine, city] of HOSPITALS) {
    const row = await prisma.hospital.create({
      data: { name, slug: slugify(name, false), addressLine, city, phone: nextPhone() },
    });
    hospitals.set(name, row.id);
  }

  console.log("Seeding administrators…");
  const superAdmin = await createUser({
    name: "Platform Owner", email: "admin@medibook.test",
    role: "SUPER_ADMIN", passwordHash, phone: nextPhone(),
  });
  await createUser({
    name: "Ops Reviewer", email: "reviewer@medibook.test",
    role: "ADMIN", passwordHash, phone: nextPhone(),
  });

  console.log(`Seeding ${DOCTORS.length} doctors…`);
  const doctorIds: { id: string; seed: DoctorSeed; clinicId: string }[] = [];

  for (const [index, seed] of DOCTORS.entries()) {
    const user = await createUser({
      name: `${seed.firstName} ${seed.lastName}`,
      email: seed.email, role: "DOCTOR", passwordHash, phone: nextPhone(),
    });

    const clinic = await prisma.clinic.create({
      data: {
        name: seed.clinicName,
        slug: slugify(`${seed.clinicName} ${seed.city}`, false),
        addressLine: seed.clinicAddress,
        city: seed.city,
        timezone: TZ,
        phone: nextPhone(),
        hospitalId: seed.hospital ? hospitals.get(seed.hospital) : null,
      },
    });

    const doctor = await prisma.doctor.create({
      data: {
        userId: user.id,
        slug: slugify(`${seed.firstName} ${seed.lastName} ${seed.primarySpecialty}`, false),
        bio: seed.bio,
        gender: seed.gender,
        licenseNumber: `PMC-${(100_000 + index * 137).toString()}`,
        licenseAuthority: "Pakistan Medical Commission",
        licenseExpiresAt: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000),
        yearsOfExperience: seed.experience,
        timezone: TZ,
        inPersonFeeMinor: seed.fees.IN_PERSON ?? 0,
        videoFeeMinor: seed.fees.VIDEO ?? 0,
        phoneFeeMinor: seed.fees.PHONE ?? 0,
        supportsInPerson: seed.fees.IN_PERSON !== undefined,
        supportsVideo: seed.fees.VIDEO !== undefined,
        supportsPhone: seed.fees.PHONE !== undefined,
        consultationDurationMinutes: seed.durationMinutes,
        bufferMinutes: 5,
        verificationStatus: seed.verification,
        verifiedAt: seed.verification === "APPROVED" ? new Date() : null,
        isAcceptingPatients: seed.accepting,
        vacationMode: seed.vacation,
        vacationStartsAt: seed.vacation ? new Date() : null,
        vacationEndsAt: seed.vacation ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
        ratingAverage: seed.rating,
        ratingCount: seed.ratingCount,
        completedAppointments: seed.ratingCount * 7,
        specialties: {
          create: seed.specialties.map((name) => ({
            specialtyId: specialties.get(name) as string,
            isPrimary: name === seed.primarySpecialty,
          })),
        },
        languages: {
          create: seed.languages.map((name) => ({
            languageId: languages.get(name) as string,
            proficiency: name === "English" ? "FLUENT" : "NATIVE",
          })),
        },
        clinics: { create: [{ clinicId: clinic.id, isPrimary: true }] },
        education: {
          create: seed.education.map(([degree, institution, endYear]) => ({
            degree, institution, startYear: endYear - 5, endYear,
          })),
        },
        certificates: {
          create: seed.certificates.map(([name, issuingBody, year]) => ({
            name, issuingBody, issuedAt: new Date(Date.UTC(year, 0, 15)),
          })),
        },
        verification: {
          create: {
            status: seed.verification,
            submittedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            reviewedAt: seed.verification === "APPROVED" ? new Date() : null,
            reviewedById: seed.verification === "APPROVED" ? superAdmin.id : null,
          },
        },
      },
    });

    if (seed.hospital) {
      await prisma.hospitalAffiliation.create({
        data: {
          doctorId: doctor.id,
          hospitalId: hospitals.get(seed.hospital) as string,
          position: `Consultant ${seed.primarySpecialty}`,
          startedAt: new Date(Date.UTC(2020 - Math.floor(seed.experience / 3), 0, 1)),
        },
      });
    }

    doctorIds.push({ id: doctor.id, seed, clinicId: clinic.id });
  }

  console.log("Seeding availability and slots…");
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + SLOT_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  let totalSlots = 0;

  for (const { id: doctorId, seed, clinicId } of doctorIds) {
    if (seed.verification !== "APPROVED") continue;

    const modes = Object.keys(seed.fees) as ConsultationMode[];
    const rules: AvailabilityRuleInput[] = [];

    for (const dayOfWeek of seed.workDays) {
      for (const mode of modes) {
        rules.push({
          id: `${doctorId}-${dayOfWeek}-${mode}`,
          clinicId: mode === "IN_PERSON" ? clinicId : null,
          mode,
          dayOfWeek,
          startMinute: seed.workStart,
          endMinute: seed.workEnd,
          slotDurationMinutes: seed.durationMinutes,
          breakStartMinute: seed.breakStart,
          breakEndMinute: seed.breakEnd,
          effectiveFrom: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          effectiveTo: null,
          isActive: true,
        });
      }
    }

    await prisma.availabilityRule.createMany({
      data: rules.map((rule) => ({
        doctorId,
        clinicId: rule.clinicId,
        mode: rule.mode,
        dayOfWeek: rule.dayOfWeek,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        slotDurationMinutes: rule.slotDurationMinutes,
        breakStartMinute: rule.breakStartMinute,
        breakEndMinute: rule.breakEndMinute,
        effectiveFrom: rule.effectiveFrom,
      })),
      skipDuplicates: true,
    });

    const slots = generateSlots({
      doctorId,
      timezone: TZ,
      rules,
      exceptions: [],
      from: now,
      to: horizonEnd,
      bufferMinutes: 5,
      currency: "PKR",
      feeByMode: seed.fees,
      vacation: { enabled: seed.vacation, startsAt: now, endsAt: horizonEnd },
      minLeadMinutes: 60,
      now,
    });

    if (slots.length > 0) {
      await prisma.appointmentSlot.createMany({
        data: slots.map((slot) => ({
          doctorId: slot.doctorId,
          clinicId: slot.clinicId,
          mode: slot.mode,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          priceMinor: slot.priceMinor,
          currency: slot.currency,
        })),
        skipDuplicates: true,
      });
      totalSlots += slots.length;
    }
  }

  console.log("Seeding patients…");
  const patientRows: { id: string; userId: string; name: string }[] = [];
  for (const patient of PATIENTS) {
    const user = await createUser({
      name: `${patient.firstName} ${patient.lastName}`,
      email: patient.email, role: "PATIENT", passwordHash, phone: nextPhone(),
    });
    const row = await prisma.patient.create({
      data: {
        userId: user.id,
        gender: patient.gender,
        city: patient.city,
        country: "PK",
        dateOfBirth: new Date(Date.UTC(1990, 4, 12)),
        bloodGroup: "O_POSITIVE",
        allergies: patient.firstName === "Hina" ? ["Penicillin"] : [],
      },
    });
    patientRows.push({ id: row.id, userId: user.id, name: user.name });
  }

  console.log("Seeding appointments, payments and reviews…");
  const bookableDoctors = doctorIds.filter((entry) => entry.seed.verification === "APPROVED");
  let appointmentCount = 0;

  for (const [index, patient] of patientRows.entries()) {
    const target = bookableDoctors[index % bookableDoctors.length];
    if (!target) continue;

    // One completed appointment in the past, carrying a payment and a review.
    const pastStart = new Date(now.getTime() - (index + 3) * 24 * 60 * 60 * 1000);
    const pastEnd = new Date(pastStart.getTime() + target.seed.durationMinutes * 60_000);
    const fee = target.seed.fees.IN_PERSON ?? target.seed.fees.VIDEO ?? 100_000;

    const completed = await prisma.appointment.create({
      data: {
        referenceCode: appointmentReference(),
        patientId: patient.id,
        doctorId: target.id,
        clinicId: target.clinicId,
        mode: target.seed.fees.IN_PERSON ? "IN_PERSON" : "VIDEO",
        status: "COMPLETED",
        startsAt: pastStart,
        endsAt: pastEnd,
        timezone: TZ,
        reasonForVisit: "Routine consultation",
        feeMinor: fee,
        totalMinor: fee,
        currency: "PKR",
        confirmedAt: pastStart,
        completedAt: pastEnd,
        payment: {
          create: {
            patientId: patient.id,
            provider: "MOCK",
            status: "SUCCEEDED",
            amountMinor: fee,
            currency: "PKR",
            idempotencyKey: `seed-${patient.id}-${target.id}`,
            providerPaymentId: `mock_pi_seed_${index}`,
            paidAt: pastStart,
          },
        },
        invoice: {
          create: {
            invoiceNumber: invoiceNumber(index + 1, pastStart),
            patientId: patient.id,
            status: "PAID",
            subtotalMinor: fee,
            totalMinor: fee,
            currency: "PKR",
            issuedAt: pastStart,
            paidAt: pastStart,
            lineItems: {
              create: [{
                description: `Consultation with Dr. ${target.seed.firstName} ${target.seed.lastName}`,
                quantity: 1, unitPriceMinor: fee, totalMinor: fee,
              }],
            },
          },
        },
      },
    });
    appointmentCount++;

    await prisma.review.create({
      data: {
        appointmentId: completed.id,
        patientId: patient.id,
        doctorId: target.id,
        rating: 5,
        punctualityRating: 5,
        valueRating: index === 0 ? 4 : 5,
        title: index === 0 ? "Explained everything clearly" : "Very thorough",
        comment:
          index === 0
            ? "Went through my results line by line and explained why surgery was not needed yet. First time a specialist has given me that much time."
            : "Punctual, unhurried, and the follow-up instructions were written down for me.",
        status: index === 2 ? "PENDING" : "PUBLISHED",
        doctorReply: index === 0 ? "Thank you — please keep up with the follow-up in six months." : null,
        doctorRepliedAt: index === 0 ? new Date() : null,
      },
    });

    // One upcoming confirmed appointment, taken from a real generated slot.
    const upcomingSlot = await prisma.appointmentSlot.findFirst({
      where: { doctorId: target.id, status: "AVAILABLE", startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
    });

    if (upcomingSlot) {
      await prisma.appointment.create({
        data: {
          referenceCode: appointmentReference(),
          patientId: patient.id,
          doctorId: target.id,
          clinicId: upcomingSlot.clinicId,
          slotId: upcomingSlot.id,
          mode: upcomingSlot.mode,
          status: "CONFIRMED",
          startsAt: upcomingSlot.startsAt,
          endsAt: upcomingSlot.endsAt,
          timezone: TZ,
          reasonForVisit: "Follow-up",
          feeMinor: upcomingSlot.priceMinor,
          totalMinor: upcomingSlot.priceMinor,
          currency: "PKR",
          confirmedAt: now,
        },
      });
      await prisma.appointmentSlot.update({
        where: { id: upcomingSlot.id },
        data: { status: "BOOKED" },
      });
      appointmentCount++;
    }

    await prisma.savedDoctor.create({
      data: { patientId: patient.id, doctorId: target.id },
    });
  }

  console.log("Seeding coupons, settings and triage rules…");
  await prisma.coupon.createMany({
    data: [
      {
        code: "FIRSTVISIT", description: "20% off your first consultation",
        type: "PERCENTAGE", value: 20, maxDiscountMinor: 100_000,
        usageLimit: 1_000, perUserLimit: 1,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
      {
        code: "TELEHEALTH500", description: "Rs 500 off any video consultation",
        type: "FIXED_AMOUNT", value: 50_000, minOrderMinor: 150_000,
        usageLimit: 500, perUserLimit: 2,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
      {
        code: "EXPIRED10", description: "Lapsed campaign, retained for reporting",
        type: "PERCENTAGE", value: 10, isActive: false,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ],
  });

  await prisma.systemSetting.createMany({
    data: SYSTEM_SETTINGS.map(([key, value, valueType, group, label, isPublic]) => ({
      key, value, valueType, group, label, isPublic,
    })),
  });

  await prisma.symptomRule.createMany({
    data: SYMPTOM_RULES.map((rule) => ({
      keywords: [...rule.keywords],
      specialtyId: rule.specialty ? (specialties.get(rule.specialty) ?? null) : null,
      triageLevel: rule.triageLevel,
      advice: rule.advice,
      priority: rule.priority,
    })),
  });

  const counts = {
    users: await prisma.user.count(),
    doctors: await prisma.doctor.count(),
    patients: await prisma.patient.count(),
    specialties: await prisma.specialty.count(),
    clinics: await prisma.clinic.count(),
    slots: await prisma.appointmentSlot.count(),
    appointments: await prisma.appointment.count(),
    reviews: await prisma.review.count(),
  };

  console.log("\nSeed complete:");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(14)} ${value}`);
  }
  console.log(`  slots generated ${totalSlots}, appointments ${appointmentCount}`);
  console.log(`\nSign in with any seeded email and password: ${DEFAULT_PASSWORD}`);
  console.log("  admin@medibook.test        (SUPER_ADMIN)");
  console.log("  ayesha.siddiqui@medibook.test (DOCTOR)");
  console.log("  hina.rauf@medibook.test    (PATIENT)");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
