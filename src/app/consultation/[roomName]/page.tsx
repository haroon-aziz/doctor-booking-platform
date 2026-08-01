import { ArrowLeft, Clock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { findAppointmentByRoomName } from "@/features/appointments/repositories/appointment.repository";
import { ConsultationRoom } from "@/features/telehealth/components/consultation-room";
import { requireUser } from "@/lib/auth/session";
import { formatInTimezone } from "@/lib/utils/datetime";

export const metadata: Metadata = {
  title: "Consultation",
  robots: { index: false, follow: false },
};

/** Matches the join window the appointment repository advertises. */
const OPENS_MINUTES_BEFORE = 10;
const CLOSES_MINUTES_AFTER = 30;

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ roomName: string }>;
}) {
  const user = await requireUser();
  const { roomName } = await params;

  const session = await findAppointmentByRoomName(roomName);
  if (!session) notFound();

  // Only the two people on the appointment may enter. Knowing the room name is
  // not authorisation — room names appear in URLs, logs and shared screens.
  //
  // A non-participant gets 404 rather than 403: confirming the room exists
  // would leak that a guessed name was correct, and `forbidden()` would need
  // Next's experimental authInterrupts flag anyway.
  const role =
    session.patientUserId === user.id
      ? "patient"
      : session.doctorUserId === user.id
        ? "doctor"
        : null;

  if (!role) notFound();

  const now = new Date();
  const opensAt = new Date(session.startsAt.getTime() - OPENS_MINUTES_BEFORE * 60_000);
  const closesAt = new Date(session.endsAt.getTime() + CLOSES_MINUTES_AFTER * 60_000);

  const cancelled = session.status.startsWith("CANCELLED") || session.status === "EXPIRED";
  const peerName = role === "patient" ? session.doctorName : session.patientName;

  if (cancelled) {
    return (
      <ConsultationNotice
        title="This consultation was cancelled"
        body="The appointment is no longer active, so the room is closed."
      />
    );
  }

  if (now < opensAt) {
    return (
      <ConsultationNotice
        title="The room is not open yet"
        body={`Your consultation with ${role === "patient" ? `Dr. ${peerName}` : peerName} starts at ${formatInTimezone(session.startsAt, "Asia/Karachi", "HH:mm 'on' EEEE d MMMM")}. You can join from ${OPENS_MINUTES_BEFORE} minutes before.`}
        icon="clock"
      />
    );
  }

  if (now > closesAt) {
    return (
      <ConsultationNotice
        title="This consultation has ended"
        body="The room closed after the appointment finished. If you need a follow-up, book another time with the same doctor."
      />
    );
  }

  return (
    <ConsultationRoom
      roomName={roomName}
      peerName={peerName}
      role={role}
      startsAt={session.startsAt.toISOString()}
    />
  );
}

function ConsultationNotice({
  title,
  body,
  icon = "shield",
}: {
  title: string;
  body: string;
  icon?: "shield" | "clock";
}) {
  const Icon = icon === "clock" ? Clock : ShieldCheck;

  return (
    <div className="container flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/appointments">
          <ArrowLeft aria-hidden />
          Back to appointments
        </Link>
      </Button>
    </div>
  );
}
