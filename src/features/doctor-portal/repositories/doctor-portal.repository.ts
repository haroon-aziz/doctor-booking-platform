import type { AppointmentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { startOfLocalDay } from "@/lib/utils/datetime";

/**
 * Read models for the doctor portal.
 *
 * Every query is scoped by `doctorId` at the database level rather than
 * filtered after the fact — a doctor must never be able to read another
 * doctor's appointments or revenue, and a forgotten `.filter()` in a component
 * is a much easier mistake to make than a missing `where` clause.
 */

export interface DoctorDashboardStats {
  todayCount: number;
  upcomingCount: number;
  completedThisMonth: number;
  cancelledThisMonth: number;
  revenueThisMonthMinor: number;
  revenueLastMonthMinor: number;
  pendingReviews: number;
  ratingAverage: number;
  ratingCount: number;
  currency: string;
}

export interface DoctorAppointmentRow {
  id: string;
  referenceCode: string;
  patientName: string;
  patientInitials: string;
  mode: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  reasonForVisit: string | null;
  totalMinor: number;
  currency: string;
  paymentStatus: string | null;
  hasVideoRoom: boolean;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export async function getDashboardStats(
  doctorId: string,
  timezone: string,
): Promise<DoctorDashboardStats> {
  const now = new Date();
  const todayStart = startOfLocalDay(now, timezone);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const activeStatuses: AppointmentStatus[] = ["CONFIRMED", "IN_PROGRESS"];

  const [
    todayCount,
    upcomingCount,
    completedThisMonth,
    cancelledThisMonth,
    revenueThisMonth,
    revenueLastMonth,
    pendingReviews,
    doctor,
  ] = await Promise.all([
    prisma.appointment.count({
      where: {
        doctorId,
        startsAt: { gte: todayStart, lt: todayEnd },
        status: { in: activeStatuses },
      },
    }),
    prisma.appointment.count({
      where: { doctorId, startsAt: { gte: now }, status: { in: activeStatuses } },
    }),
    prisma.appointment.count({
      where: { doctorId, status: "COMPLETED", completedAt: { gte: monthStart } },
    }),
    prisma.appointment.count({
      where: {
        doctorId,
        status: { in: ["CANCELLED_BY_PATIENT", "CANCELLED_BY_DOCTOR", "NO_SHOW"] },
        cancelledAt: { gte: monthStart },
      },
    }),
    // Revenue counts only money actually captured, not merely booked.
    prisma.appointment.aggregate({
      where: {
        doctorId,
        status: "COMPLETED",
        completedAt: { gte: monthStart },
        payment: { status: "SUCCEEDED" },
      },
      _sum: { totalMinor: true },
    }),
    prisma.appointment.aggregate({
      where: {
        doctorId,
        status: "COMPLETED",
        completedAt: { gte: lastMonthStart, lt: monthStart },
        payment: { status: "SUCCEEDED" },
      },
      _sum: { totalMinor: true },
    }),
    prisma.review.count({ where: { doctorId, status: "PUBLISHED", doctorReply: null } }),
    prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { ratingAverage: true, ratingCount: true, currency: true },
    }),
  ]);

  return {
    todayCount,
    upcomingCount,
    completedThisMonth,
    cancelledThisMonth,
    revenueThisMonthMinor: revenueThisMonth._sum.totalMinor ?? 0,
    revenueLastMonthMinor: revenueLastMonth._sum.totalMinor ?? 0,
    pendingReviews,
    ratingAverage: doctor?.ratingAverage ?? 0,
    ratingCount: doctor?.ratingCount ?? 0,
    currency: doctor?.currency ?? "PKR",
  };
}

export async function listDoctorAppointments(
  doctorId: string,
  filter: { scope: "upcoming" | "today" | "past" | "all"; timezone: string; limit?: number },
): Promise<DoctorAppointmentRow[]> {
  const now = new Date();
  const todayStart = startOfLocalDay(now, filter.timezone);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const where = {
    doctorId,
    deletedAt: null,
    ...(filter.scope === "today"
      ? { startsAt: { gte: todayStart, lt: todayEnd } }
      : filter.scope === "upcoming"
        ? { startsAt: { gte: now } }
        : filter.scope === "past"
          ? { startsAt: { lt: now } }
          : {}),
  };

  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: filter.scope === "past" ? "desc" : "asc" },
    take: filter.limit ?? 50,
    include: {
      patient: { include: { user: { select: { name: true } } } },
      payment: { select: { status: true } },
      videoSession: { select: { id: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    referenceCode: row.referenceCode,
    patientName: row.patient.user.name,
    patientInitials: initialsOf(row.patient.user.name),
    mode: row.mode,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reasonForVisit: row.reasonForVisit,
    totalMinor: row.totalMinor,
    currency: row.currency,
    paymentStatus: row.payment?.status ?? null,
    hasVideoRoom: row.videoSession !== null,
  }));
}

export interface AvailabilityRuleRow {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  mode: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  slotDurationMinutes: number;
  breakStartMinute: number | null;
  breakEndMinute: number | null;
  isActive: boolean;
}

export async function listAvailabilityRules(doctorId: string): Promise<AvailabilityRuleRow[]> {
  const rows = await prisma.availabilityRule.findMany({
    where: { doctorId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    include: { clinic: { select: { name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    clinicId: row.clinicId,
    clinicName: row.clinic?.name ?? null,
    mode: row.mode,
    dayOfWeek: row.dayOfWeek,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    slotDurationMinutes: row.slotDurationMinutes,
    breakStartMinute: row.breakStartMinute,
    breakEndMinute: row.breakEndMinute,
    isActive: row.isActive,
  }));
}

/** Daily completed-revenue series for the dashboard chart. */
export async function getRevenueSeries(
  doctorId: string,
  days: number,
): Promise<{ date: string; totalMinor: number }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: "COMPLETED",
      completedAt: { gte: since },
      payment: { status: "SUCCEEDED" },
    },
    select: { completedAt: true, totalMinor: true },
  });

  const buckets = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }

  for (const row of rows) {
    if (!row.completedAt) continue;
    const key = row.completedAt.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + row.totalMinor);
  }

  return [...buckets.entries()].map(([date, totalMinor]) => ({ date, totalMinor }));
}
