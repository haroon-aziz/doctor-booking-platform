import {
  ArrowLeft,
  CalendarDays,
  Clock,
  FileText,
  MapPin,
  Phone,
  Receipt,
  Stethoscope,
  Video,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelAppointment } from "@/features/appointments/components/cancel-appointment";
import { getPatientAppointment } from "@/features/appointments/repositories/appointment.repository";
import { requirePatient } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatInTimezone } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Appointment details",
  robots: { index: false, follow: false },
};

const STATUS_VARIANT: Record<
  string,
  "default" | "success" | "warning" | "destructive" | "secondary"
> = {
  PENDING_PAYMENT: "warning",
  CONFIRMED: "success",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
  CANCELLED_BY_PATIENT: "destructive",
  CANCELLED_BY_DOCTOR: "destructive",
  NO_SHOW: "destructive",
  EXPIRED: "secondary",
};

const MODE_ICON = { IN_PERSON: MapPin, VIDEO: Video, PHONE: Phone } as const;

export default async function AppointmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ booked?: string }>;
}) {
  const { patientId } = await requirePatient();
  const [{ id }, { booked }] = await Promise.all([params, searchParams]);

  const appointment = await getPatientAppointment(patientId, id);

  // Null covers both "does not exist" and "belongs to someone else". Rendering
  // 404 for the second case avoids confirming that a reference code is real.
  if (!appointment) notFound();

  const windowSetting = await prisma.systemSetting.findUnique({
    where: { key: "booking.cancellation_window_hours" },
  });
  const freeWindowHours = Number(windowSetting?.value ?? 24);

  const startsAt = new Date(appointment.startsAt);
  const hoursUntilStart = (startsAt.getTime() - Date.now()) / 3_600_000;
  const ModeIcon = MODE_ICON[appointment.mode];

  return (
    <div className="container max-w-3xl py-10">
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          href="/appointments"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All appointments
        </Link>
      </nav>

      {booked === "1" && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success"
        >
          Your appointment is confirmed. Reference{" "}
          <strong className="font-mono">{appointment.referenceCode}</strong>.
        </div>
      )}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Dr. {appointment.doctorName}
            </h1>
            <Badge variant={STATUS_VARIANT[appointment.status] ?? "secondary"}>
              {appointment.status.replace(/_/g, " ").toLowerCase()}
            </Badge>
          </div>
          {appointment.specialty && (
            <p className="text-muted-foreground">{appointment.specialty}</p>
          )}
          <p className="font-mono text-xs text-muted-foreground">
            {appointment.referenceCode}
          </p>
        </div>

        {appointment.canJoin && appointment.videoRoomName && (
          <Button asChild size="lg">
            <Link href={`/consultation/${appointment.videoRoomName}`}>
              <Video aria-hidden />
              Join consultation
            </Link>
          </Button>
        )}
      </header>

      {appointment.mode === "VIDEO" &&
        appointment.status === "CONFIRMED" &&
        !appointment.canJoin && (
          <div className="mb-6 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            The video room opens 10 minutes before your appointment starts.
          </div>
        )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="text-sm text-muted-foreground">Date</dt>
                  <dd className="font-medium">
                    {formatInTimezone(startsAt, appointment.timezone, "EEEE d MMMM yyyy")}
                  </dd>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="text-sm text-muted-foreground">Time</dt>
                  <dd className="font-medium">
                    {formatInTimezone(startsAt, appointment.timezone, "HH:mm")} –{" "}
                    {formatInTimezone(
                      new Date(appointment.endsAt),
                      appointment.timezone,
                      "HH:mm",
                    )}
                  </dd>
                  <dd className="text-xs text-muted-foreground">{appointment.timezone}</dd>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <ModeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="text-sm text-muted-foreground">Type</dt>
                  <dd className="font-medium">
                    {appointment.mode === "IN_PERSON"
                      ? "In person"
                      : appointment.mode === "VIDEO"
                        ? "Video consultation"
                        : "Phone consultation"}
                  </dd>
                  {appointment.clinicName && (
                    <dd className="text-sm text-muted-foreground">
                      {appointment.clinicName}
                      {appointment.clinicAddress && `, ${appointment.clinicAddress}`}
                    </dd>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Receipt aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="text-sm text-muted-foreground">Paid</dt>
                  <dd className="font-medium">
                    {formatMoney(appointment.totalMinor, appointment.currency)}
                  </dd>
                  {appointment.discountMinor > 0 && (
                    <dd className="text-sm text-success">
                      {formatMoney(appointment.discountMinor, appointment.currency)} discount
                      applied
                    </dd>
                  )}
                  {appointment.invoiceNumber && (
                    <dd className="font-mono text-xs text-muted-foreground">
                      {appointment.invoiceNumber}
                    </dd>
                  )}
                </div>
              </div>
            </dl>
          </CardContent>
        </Card>

        {(appointment.reasonForVisit || appointment.patientNotes) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText aria-hidden className="size-5 text-primary" />
                What you told the doctor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {appointment.reasonForVisit && (
                <div>
                  <p className="text-muted-foreground">Reason for visit</p>
                  <p>{appointment.reasonForVisit}</p>
                </div>
              )}
              {appointment.patientNotes && (
                <div>
                  <p className="text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{appointment.patientNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(appointment.doctorNotes || appointment.diagnosis) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope aria-hidden className="size-5 text-primary" />
                Consultation summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {appointment.diagnosis && (
                <div>
                  <p className="text-muted-foreground">Assessment</p>
                  <p>{appointment.diagnosis}</p>
                </div>
              )}
              {appointment.doctorNotes && (
                <div>
                  <p className="text-muted-foreground">Notes from the doctor</p>
                  <p className="whitespace-pre-wrap">{appointment.doctorNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {appointment.cancellationReason && (
          <Card className="border-destructive/30">
            <CardContent className="py-4 text-sm">
              <p className="font-medium">
                Cancelled
                {appointment.cancelledByRole
                  ? ` by the ${appointment.cancelledByRole.toLowerCase()}`
                  : ""}
              </p>
              <p className="mt-1 text-muted-foreground">{appointment.cancellationReason}</p>
            </CardContent>
          </Card>
        )}

        {(appointment.canCancel || appointment.canReschedule) && (
          <div className="flex flex-wrap gap-3 border-t pt-6">
            {appointment.canReschedule && (
              <Button asChild variant="outline">
                <Link href={`/doctors/${appointment.doctorSlug}#book`}>Reschedule</Link>
              </Button>
            )}
            {appointment.canCancel && (
              <CancelAppointment
                appointmentId={appointment.id}
                hoursUntilStart={hoursUntilStart}
                freeWindowHours={freeWindowHours}
              />
            )}
          </div>
        )}

        {appointment.status === "COMPLETED" && !appointment.hasReview && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-sm">How was your consultation? Your review helps other patients.</p>
              <Button asChild size="sm" variant="outline">
                <Link href={`/doctors/${appointment.doctorSlug}`}>Leave a review</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
