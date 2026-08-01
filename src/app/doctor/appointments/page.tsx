import { CalendarDays, Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listDoctorAppointments } from "@/features/doctor-portal/repositories/doctor-portal.repository";
import { requireDoctor } from "@/lib/auth/session";
import { formatInTimezone } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Appointments",
  robots: { index: false, follow: false },
};

const SCOPES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "today", label: "Today" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
] as const;

type Scope = (typeof SCOPES)[number]["value"];

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "destructive" | "secondary"> = {
  CONFIRMED: "success",
  PENDING_PAYMENT: "warning",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
  CANCELLED_BY_PATIENT: "destructive",
  CANCELLED_BY_DOCTOR: "destructive",
  NO_SHOW: "destructive",
  EXPIRED: "secondary",
};

export default async function DoctorAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { user, doctorId } = await requireDoctor();
  const { scope: rawScope } = await searchParams;

  const scope: Scope = SCOPES.some((option) => option.value === rawScope)
    ? (rawScope as Scope)
    : "upcoming";

  const appointments = await listDoctorAppointments(doctorId, {
    scope,
    timezone: user.timezone,
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
        <p className="text-muted-foreground">
          Times shown in {user.timezone.replace("_", " ")}.
        </p>
      </header>

      <nav aria-label="Filter appointments" className="flex gap-1 rounded-lg bg-muted p-1">
        {SCOPES.map((option) => (
          <Link
            key={option.value}
            href={`/doctor/appointments?scope=${option.value}`}
            aria-current={scope === option.value ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors",
              scope === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {appointments.length > 0 ? (
        <ul className="space-y-3">
          {appointments.map((appointment) => {
            const startsAt = new Date(appointment.startsAt);

            return (
              <li key={appointment.id}>
                <Card>
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <span
                      aria-hidden
                      className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground"
                    >
                      {appointment.patientInitials}
                    </span>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{appointment.patientName}</p>
                        <Badge variant={STATUS_VARIANT[appointment.status] ?? "secondary"}>
                          {appointment.status.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                        {appointment.mode === "VIDEO" && (
                          <Badge variant="outline">
                            <Video aria-hidden />
                            Video
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {appointment.reasonForVisit ?? "No reason given"}
                      </p>

                      <p className="font-mono text-xs text-muted-foreground">
                        {appointment.referenceCode}
                      </p>
                    </div>

                    <div className="shrink-0 space-y-1 sm:text-right">
                      <p className="text-sm font-medium">
                        {formatInTimezone(startsAt, user.timezone, "EEE d MMM")}
                      </p>
                      <p className="text-sm tabular-nums text-muted-foreground">
                        {formatInTimezone(startsAt, user.timezone, "HH:mm")} –{" "}
                        {formatInTimezone(new Date(appointment.endsAt), user.timezone, "HH:mm")}
                      </p>
                      <p className="text-sm font-semibold">
                        {formatMoney(appointment.totalMinor, appointment.currency)}
                      </p>
                    </div>

                    {appointment.hasVideoRoom && appointment.status === "CONFIRMED" && (
                      <Button asChild size="sm" className="shrink-0">
                        <Link href={`/consultation/${appointment.id}`}>Join</Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CalendarDays aria-hidden className="size-8 text-muted-foreground" />
            <p className="font-medium">No {scope} appointments</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Patients who book will appear here. Check your schedule has open slots.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/doctor/schedule">Review schedule</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
