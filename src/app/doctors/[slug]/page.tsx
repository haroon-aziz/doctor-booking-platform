import {
  Award,
  Building2,
  GraduationCap,
  Languages as LanguagesIcon,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Star,
  Stethoscope,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AvailabilityPanel } from "@/features/booking/components/availability-panel";
import { getSlotRepository } from "@/features/booking/repositories";
import { getDoctorRepository } from "@/features/doctors/repositories";
import { formatMoney } from "@/lib/utils/money";

export const revalidate = 120;

const AVAILABILITY_DAYS = 7;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doctor = await getDoctorRepository().findBySlug(slug);

  if (!doctor) return { title: "Doctor not found" };

  const description = `${doctor.title} ${doctor.fullName} — ${doctor.headline} in ${doctor.city}. ${doctor.ratingAverage.toFixed(1)}★ from ${doctor.ratingCount} patient reviews. Book online.`;

  return {
    title: `${doctor.title} ${doctor.fullName} — ${doctor.primarySpecialty}`,
    description,
    alternates: { canonical: `/doctors/${doctor.slug}` },
    openGraph: { title: `${doctor.title} ${doctor.fullName}`, description, type: "profile" },
  };
}

export default async function DoctorProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doctor = await getDoctorRepository().findBySlug(slug);

  if (!doctor) notFound();

  const availability = await getSlotRepository().getAvailability({
    doctorId: doctor.id,
    days: AVAILABILITY_DAYS,
  });

  const totalReviews = Object.values(doctor.ratingBreakdown).reduce((sum, n) => sum + n, 0);

  // Physician schema makes the profile eligible for rich results.
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Physician",
    name: `${doctor.title} ${doctor.fullName}`,
    medicalSpecialty: doctor.specialties,
    address: {
      "@type": "PostalAddress",
      addressLocality: doctor.city,
      streetAddress: doctor.clinicAddress ?? undefined,
      addressCountry: "PK",
    },
    ...(doctor.ratingCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: doctor.ratingAverage,
            reviewCount: doctor.ratingCount,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className="border-b surface-gradient">
        <div className="container py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div
              aria-hidden
              className="grid size-24 shrink-0 place-items-center rounded-2xl bg-accent text-2xl font-semibold text-accent-foreground"
            >
              {initials(doctor.fullName)}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight">
                  {doctor.title} {doctor.fullName}
                </h1>
                {doctor.isVerified && (
                  <Badge variant="success">
                    <ShieldCheck aria-hidden />
                    Verified
                  </Badge>
                )}
                {!doctor.isAcceptingPatients && (
                  <Badge variant="warning">Not accepting new patients</Badge>
                )}
              </div>

              <p className="text-lg text-muted-foreground">{doctor.headline}</p>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                {doctor.ratingCount > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Star aria-hidden className="size-4 fill-warning text-warning" />
                    {doctor.ratingAverage.toFixed(1)}
                    <span className="font-normal text-muted-foreground">
                      ({doctor.ratingCount} reviews)
                    </span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Stethoscope aria-hidden className="size-4" />
                  {doctor.yearsOfExperience} years experience
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <MapPin aria-hidden className="size-4" />
                  {doctor.clinicName ?? doctor.city}, {doctor.city}
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <LanguagesIcon aria-hidden className="size-4" />
                  {doctor.languages.join(", ")}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {doctor.specialties.map((specialty) => (
                  <Badge key={specialty} variant="secondary">
                    {specialty}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container grid gap-8 py-10 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>{doctor.bio}</p>
            </CardContent>
          </Card>

          {doctor.education.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap aria-hidden className="size-5 text-primary" />
                  Education
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {doctor.education.map((entry) => (
                    <li key={`${entry.degree}-${entry.institution}`} className="flex justify-between gap-4">
                      <div>
                        <p className="font-medium">{entry.degree}</p>
                        <p className="text-sm text-muted-foreground">{entry.institution}</p>
                      </div>
                      {entry.endYear && (
                        <span className="shrink-0 text-sm text-muted-foreground">{entry.endYear}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {doctor.certificates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award aria-hidden className="size-5 text-primary" />
                  Certifications
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {doctor.certificates.map((entry) => (
                    <li key={entry.name} className="flex justify-between gap-4">
                      <div>
                        <p className="font-medium">{entry.name}</p>
                        <p className="text-sm text-muted-foreground">{entry.issuingBody}</p>
                      </div>
                      <span className="shrink-0 text-sm text-muted-foreground">{entry.issuedYear}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {doctor.affiliations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 aria-hidden className="size-5 text-primary" />
                  Hospital affiliations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {doctor.affiliations.map((entry) => (
                    <li key={entry.hospitalName}>
                      <p className="font-medium">{entry.hospitalName}</p>
                      <p className="text-sm text-muted-foreground">{entry.position}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare aria-hidden className="size-5 text-primary" />
                Patient reviews
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {totalReviews > 0 && (
                <div className="space-y-1.5">
                  {([5, 4, 3, 2, 1] as const).map((star) => {
                    const count = doctor.ratingBreakdown[star];
                    const percent = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-3 text-sm">
                        <span className="w-6 text-muted-foreground">{star}★</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-warning" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="w-10 text-right text-muted-foreground">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {doctor.reviews.length > 0 ? (
                <ul className="space-y-5">
                  {doctor.reviews.map((review) => (
                    <li key={review.id} className="space-y-2 border-t pt-5 first:border-t-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{review.authorName}</p>
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Star aria-hidden className="size-3.5 fill-warning text-warning" />
                          {review.rating}
                        </span>
                      </div>
                      {review.title && <p className="text-sm font-medium">{review.title}</p>}
                      <p className="text-sm text-muted-foreground">{review.comment}</p>
                      <time className="block text-xs text-muted-foreground" dateTime={review.createdAt}>
                        {new Date(review.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </time>
                      {review.doctorReply && (
                        <div className="mt-2 rounded-lg border-l-2 border-primary bg-muted/50 p-3">
                          <p className="text-xs font-medium">Reply from {doctor.title} {doctor.fullName}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{review.doctorReply}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No written reviews yet. Be the first after your consultation.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside id="book" className="lg:sticky lg:top-20">
          <Card>
            <CardHeader>
              <CardTitle>Book an appointment</CardTitle>
            </CardHeader>
            <CardContent>
              {doctor.isAcceptingPatients ? (
                <AvailabilityPanel
                  doctorSlug={doctor.slug}
                  availability={availability}
                  modes={doctor.modes}
                  feesByMode={doctor.feesByMode}
                  currency={doctor.currency}
                />
              ) : (
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    {doctor.title} {doctor.fullName} is not taking new patients right now.
                  </p>
                  <p className="text-muted-foreground">
                    Consultations normally start from{" "}
                    <span className="font-medium text-foreground">
                      {formatMoney(doctor.fromFeeMinor, doctor.currency)}
                    </span>
                    .
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
