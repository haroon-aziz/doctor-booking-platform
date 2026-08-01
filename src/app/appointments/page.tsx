import { CalendarPlus, CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AppointmentCard } from "@/features/appointments/components/appointment-card";
import { listPatientAppointments } from "@/features/appointments/repositories/appointment.repository";
import { requirePatient } from "@/lib/auth/session";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Your appointments",
  robots: { index: false, follow: false },
};

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "All" },
] as const;

type Scope = (typeof TABS)[number]["key"];

function parseScope(value: string | undefined): Scope {
  return TABS.some((tab) => tab.key === value) ? (value as Scope) : "upcoming";
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; booked?: string }>;
}) {
  const { patientId } = await requirePatient();
  const { scope: rawScope, booked } = await searchParams;
  const scope = parseScope(rawScope);

  const appointments = await listPatientAppointments(patientId, scope);

  return (
    <div className="container max-w-4xl py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your appointments</h1>
          <p className="text-muted-foreground">
            Manage bookings, join video consultations and review past visits.
          </p>
        </div>
        <Button asChild>
          <Link href="/doctors">
            <CalendarPlus aria-hidden />
            Book another
          </Link>
        </Button>
      </header>

      {booked === "1" && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success"
        >
          Your appointment is confirmed. A confirmation email is on its way.
        </div>
      )}

      <nav aria-label="Filter appointments" className="mb-6 flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/appointments?scope=${tab.key}`}
            aria-current={scope === tab.key ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors",
              scope === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {appointments.length > 0 ? (
        <ul className="space-y-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <AppointmentCard appointment={appointment} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <CalendarX2 aria-hidden className="size-8 text-muted-foreground" />
          <p className="font-medium">
            {scope === "upcoming" ? "No upcoming appointments" : "Nothing here yet"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {scope === "upcoming"
              ? "When you book a consultation it will appear here, with a join link for video visits."
              : "Past and cancelled appointments will be listed here."}
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/doctors">Find a doctor</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
