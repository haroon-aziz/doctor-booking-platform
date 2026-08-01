import { CalendarDays, Clock, MapPin, Phone, Video } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppointmentListRow } from "@/features/appointments/repositories/appointment.repository";
import { formatInTimezone } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED_BY_PATIENT: "Cancelled by you",
  CANCELLED_BY_DOCTOR: "Cancelled by doctor",
  NO_SHOW: "Missed",
  EXPIRED: "Expired",
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

export function AppointmentCard({ appointment }: { appointment: AppointmentListRow }) {
  const ModeIcon = MODE_ICON[appointment.mode];
  const startsAt = new Date(appointment.startsAt);

  return (
    <article className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent font-semibold text-accent-foreground"
        >
          {appointment.doctorInitials}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">
              <Link href={`/doctors/${appointment.doctorSlug}`} className="hover:underline">
                Dr. {appointment.doctorName}
              </Link>
            </h3>
            <Badge variant={STATUS_VARIANT[appointment.status] ?? "secondary"}>
              {STATUS_LABEL[appointment.status] ?? appointment.status}
            </Badge>
          </div>

          {appointment.specialty && (
            <p className="text-sm text-muted-foreground">{appointment.specialty}</p>
          )}

          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CalendarDays aria-hidden className="size-3.5" />
              <dt className="sr-only">Date</dt>
              <dd>{formatInTimezone(startsAt, appointment.timezone, "EEE d MMM yyyy")}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock aria-hidden className="size-3.5" />
              <dt className="sr-only">Time</dt>
              <dd>
                {formatInTimezone(startsAt, appointment.timezone, "HH:mm")}–
                {formatInTimezone(new Date(appointment.endsAt), appointment.timezone, "HH:mm")}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <ModeIcon aria-hidden className="size-3.5" />
              <dt className="sr-only">Type</dt>
              <dd>
                {appointment.mode === "IN_PERSON"
                  ? (appointment.clinicName ?? "In person")
                  : appointment.mode === "VIDEO"
                    ? "Video consultation"
                    : "Phone consultation"}
              </dd>
            </div>
          </dl>

          <p className="font-mono text-xs text-muted-foreground">{appointment.referenceCode}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="font-semibold">
            {formatMoney(appointment.totalMinor, appointment.currency)}
          </span>

          {appointment.canJoin ? (
            <Button asChild size="sm">
              <Link href={`/appointments/${appointment.id}`}>
                <Video aria-hidden />
                Join now
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={`/appointments/${appointment.id}`}>Details</Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
