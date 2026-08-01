import { CalendarDays, Clock, MapPin, ShieldCheck, Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckoutForm } from "@/features/booking/components/checkout-form";
import { getSlotRepository } from "@/features/booking/repositories";
import { getDoctorRepository } from "@/features/doctors/repositories";
import { formatInTimezone } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Confirm your booking",
  robots: { index: false, follow: false },
};

const MODE_LABEL: Record<string, string> = {
  IN_PERSON: "In-person consultation",
  VIDEO: "Video consultation",
  PHONE: "Phone consultation",
};

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ slot?: string }>;
}) {
  const [{ slug }, { slot: slotId }] = await Promise.all([params, searchParams]);

  if (!slotId) notFound();

  const [doctor, slot] = await Promise.all([
    getDoctorRepository().findBySlug(slug),
    getSlotRepository().findById(slotId),
  ]);

  if (!doctor || !slot) notFound();

  const startsAt = new Date(slot.startsAt);
  // Times are always presented in the doctor's clinic timezone, which is what
  // the appointment is actually scheduled against.
  const { timezone } = await getSlotRepository().getAvailability({
    doctorId: doctor.id,
    days: 1,
  });

  return (
    <div className="container max-w-5xl py-10">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href={`/doctors/${doctor.slug}`} className="hover:text-foreground hover:underline">
          ← Back to {doctor.title} {doctor.fullName}
        </Link>
      </nav>

      <h1 className="text-3xl font-semibold tracking-tight">Confirm your booking</h1>
      <p className="mt-2 text-muted-foreground">
        Your slot is held while you complete this form.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Appointment details</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckoutForm
              slotId={slot.id}
              priceMinor={slot.priceMinor}
              currency={slot.currency}
            />
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-start gap-3">
              <div
                aria-hidden
                className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent font-semibold text-accent-foreground"
              >
                {doctor.fullName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? "")
                  .join("")}
              </div>
              <div className="min-w-0">
                <p className="font-medium">
                  {doctor.title} {doctor.fullName}
                </p>
                <p className="text-sm text-muted-foreground">{doctor.primarySpecialty}</p>
                {doctor.isVerified && (
                  <Badge variant="success" className="mt-1">
                    <ShieldCheck aria-hidden />
                    Verified
                  </Badge>
                )}
              </div>
            </div>

            <dl className="space-y-3 border-t pt-4 text-sm">
              <div className="flex items-start gap-2">
                <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="sr-only">Date and time</dt>
                  <dd className="font-medium">{formatInTimezone(startsAt, timezone, "EEEE d MMMM")}</dd>
                  <dd className="text-muted-foreground">
                    {formatInTimezone(startsAt, timezone, "HH:mm")} –{" "}
                    {formatInTimezone(new Date(slot.endsAt), timezone, "HH:mm")} ({timezone})
                  </dd>
                </div>
              </div>

              <div className="flex items-start gap-2">
                {slot.mode === "VIDEO" ? (
                  <Video aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <dt className="sr-only">Consultation type</dt>
                  <dd className="font-medium">{MODE_LABEL[slot.mode] ?? slot.mode}</dd>
                  {slot.mode === "IN_PERSON" && doctor.clinicAddress && (
                    <dd className="text-muted-foreground">{doctor.clinicAddress}</dd>
                  )}
                  {slot.mode === "VIDEO" && (
                    <dd className="text-muted-foreground">
                      A join link appears here once payment completes.
                    </dd>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="sr-only">Duration</dt>
                  <dd className="font-medium">{doctor.consultationDurationMinutes} minutes</dd>
                </div>
              </div>
            </dl>

            <div className="flex items-center justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">Consultation fee</span>
              <span className="font-semibold">{formatMoney(slot.priceMinor, slot.currency)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
