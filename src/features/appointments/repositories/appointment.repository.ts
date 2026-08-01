import type { AppointmentStatus, ConsultationMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";

/**
 * Patient-facing appointment reads.
 *
 * Scoped by `patientId` in the `where` clause, never filtered after fetching —
 * a forgotten `.filter()` in a component is a much easier mistake to make than
 * a missing `where`, and the consequence here is one patient reading another's
 * medical appointments.
 */

export interface AppointmentListRow {
  id: string;
  referenceCode: string;
  doctorName: string;
  doctorSlug: string;
  doctorInitials: string;
  specialty: string | null;
  mode: ConsultationMode;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  clinicName: string | null;
  clinicAddress: string | null;
  totalMinor: number;
  currency: string;
  paymentStatus: string | null;
  hasVideoRoom: boolean;
  canCancel: boolean;
  canReschedule: boolean;
  canJoin: boolean;
}

export interface AppointmentDetail extends AppointmentListRow {
  reasonForVisit: string | null;
  patientNotes: string | null;
  doctorNotes: string | null;
  diagnosis: string | null;
  feeMinor: number;
  discountMinor: number;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  videoRoomName: string | null;
  invoiceNumber: string | null;
  hasReview: boolean;
}

/** Video rooms open shortly before the start and stay usable slightly after. */
const JOIN_OPENS_MINUTES_BEFORE = 10;
const JOIN_CLOSES_MINUTES_AFTER = 30;

const ACTIVE: AppointmentStatus[] = ["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS"];

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function deriveCapabilities(
  status: AppointmentStatus,
  startsAt: Date,
  endsAt: Date,
  mode: ConsultationMode,
  hasVideoRoom: boolean,
  now: Date,
) {
  const upcoming = startsAt > now;
  const cancellable = status === "CONFIRMED" || status === "PENDING_PAYMENT";

  const joinOpensAt = new Date(startsAt.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000);
  const joinClosesAt = new Date(endsAt.getTime() + JOIN_CLOSES_MINUTES_AFTER * 60_000);

  return {
    canCancel: cancellable && upcoming,
    canReschedule: cancellable && upcoming,
    canJoin:
      mode === "VIDEO" &&
      hasVideoRoom &&
      (status === "CONFIRMED" || status === "IN_PROGRESS") &&
      now >= joinOpensAt &&
      now <= joinClosesAt,
  };
}

export async function listPatientAppointments(
  patientId: string,
  scope: "upcoming" | "past" | "all" = "all",
): Promise<AppointmentListRow[]> {
  const now = new Date();

  const rows = await prisma.appointment.findMany({
    where: {
      patientId,
      deletedAt: null,
      ...(scope === "upcoming"
        ? { startsAt: { gte: now }, status: { in: ACTIVE } }
        : scope === "past"
          ? { OR: [{ startsAt: { lt: now } }, { status: { notIn: ACTIVE } }] }
          : {}),
    },
    orderBy: { startsAt: scope === "past" ? "desc" : "asc" },
    take: 100,
    include: {
      doctor: {
        select: {
          slug: true,
          user: { select: { name: true } },
          specialties: {
            where: { isPrimary: true },
            select: { specialty: { select: { name: true } } },
            take: 1,
          },
        },
      },
      clinic: { select: { name: true, addressLine: true } },
      payment: { select: { status: true } },
      videoSession: { select: { id: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    referenceCode: row.referenceCode,
    doctorName: row.doctor.user.name,
    doctorSlug: row.doctor.slug,
    doctorInitials: initialsOf(row.doctor.user.name),
    specialty: row.doctor.specialties[0]?.specialty.name ?? null,
    mode: row.mode,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    clinicName: row.clinic?.name ?? null,
    clinicAddress: row.clinic?.addressLine ?? null,
    totalMinor: row.totalMinor,
    currency: row.currency,
    paymentStatus: row.payment?.status ?? null,
    hasVideoRoom: row.videoSession !== null,
    ...deriveCapabilities(
      row.status,
      row.startsAt,
      row.endsAt,
      row.mode,
      row.videoSession !== null,
      now,
    ),
  }));
}

/**
 * A single appointment, scoped to its owner. Returns null rather than throwing
 * when the id belongs to someone else, so the caller renders a 404 — revealing
 * "this exists but is not yours" would leak that a reference code is valid.
 */
export async function getPatientAppointment(
  patientId: string,
  appointmentId: string,
): Promise<AppointmentDetail | null> {
  const now = new Date();

  const row = await prisma.appointment.findFirst({
    where: { id: appointmentId, patientId, deletedAt: null },
    include: {
      doctor: {
        select: {
          slug: true,
          user: { select: { name: true } },
          specialties: {
            where: { isPrimary: true },
            select: { specialty: { select: { name: true } } },
            take: 1,
          },
        },
      },
      clinic: { select: { name: true, addressLine: true } },
      payment: { select: { status: true } },
      videoSession: { select: { id: true, roomName: true } },
      invoice: { select: { invoiceNumber: true } },
      review: { select: { id: true } },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    referenceCode: row.referenceCode,
    doctorName: row.doctor.user.name,
    doctorSlug: row.doctor.slug,
    doctorInitials: initialsOf(row.doctor.user.name),
    specialty: row.doctor.specialties[0]?.specialty.name ?? null,
    mode: row.mode,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    clinicName: row.clinic?.name ?? null,
    clinicAddress: row.clinic?.addressLine ?? null,
    totalMinor: row.totalMinor,
    currency: row.currency,
    paymentStatus: row.payment?.status ?? null,
    hasVideoRoom: row.videoSession !== null,
    reasonForVisit: row.reasonForVisit,
    patientNotes: row.patientNotes,
    doctorNotes: row.doctorNotes,
    diagnosis: row.diagnosis,
    feeMinor: row.feeMinor,
    discountMinor: row.discountMinor,
    cancellationReason: row.cancellationReason,
    cancelledByRole: row.cancelledByRole,
    videoRoomName: row.videoSession?.roomName ?? null,
    invoiceNumber: row.invoice?.invoiceNumber ?? null,
    hasReview: row.review !== null,
    ...deriveCapabilities(
      row.status,
      row.startsAt,
      row.endsAt,
      row.mode,
      row.videoSession !== null,
      now,
    ),
  };
}

/** Resolves a video room to its appointment, for the consultation page. */
export async function findAppointmentByRoomName(roomName: string): Promise<{
  appointmentId: string;
  patientUserId: string;
  doctorUserId: string;
  doctorName: string;
  patientName: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  expiresAt: Date;
} | null> {
  const session = await prisma.videoSession.findUnique({
    where: { roomName },
    include: {
      appointment: {
        include: {
          patient: { include: { user: { select: { id: true, name: true } } } },
          doctor: { include: { user: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  if (!session) return null;

  return {
    appointmentId: session.appointmentId,
    patientUserId: session.appointment.patient.user.id,
    doctorUserId: session.appointment.doctor.user.id,
    doctorName: session.appointment.doctor.user.name,
    patientName: session.appointment.patient.user.name,
    startsAt: session.appointment.startsAt,
    endsAt: session.appointment.endsAt,
    status: session.appointment.status,
    expiresAt: session.expiresAt,
  };
}

/** Records a join, used to show "the doctor has arrived" in the waiting room. */
export async function markParticipantJoined(
  roomName: string,
  role: "doctor" | "patient",
): Promise<void> {
  await prisma.videoSession.update({
    where: { roomName },
    data: role === "doctor" ? { doctorJoinedAt: new Date() } : { patientJoinedAt: new Date() },
  });
}
