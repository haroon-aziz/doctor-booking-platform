import { CalendarCheck, CalendarX2, MessageSquareWarning, Star, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDashboardStats,
  getRevenueSeries,
  listDoctorAppointments,
} from "@/features/doctor-portal/repositories/doctor-portal.repository";
import { requireDoctor } from "@/lib/auth/session";
import { formatInTimezone } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Doctor dashboard",
  robots: { index: false, follow: false },
};

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

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export default async function DoctorDashboardPage() {
  const { user, doctorId } = await requireDoctor();
  const timezone = user.timezone;

  const [stats, today, series] = await Promise.all([
    getDashboardStats(doctorId, timezone),
    listDoctorAppointments(doctorId, { scope: "today", timezone, limit: 10 }),
    getRevenueSeries(doctorId, 14),
  ]);

  const peakRevenue = Math.max(1, ...series.map((point) => point.totalMinor));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            {stats.todayCount > 0
              ? `You have ${stats.todayCount} appointment${stats.todayCount === 1 ? "" : "s"} today.`
              : "No appointments scheduled for today."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/doctor/schedule">Manage schedule</Link>
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today"
          value={String(stats.todayCount)}
          icon={CalendarCheck}
          hint={`${stats.upcomingCount} upcoming in total`}
        />
        <StatCard
          label="Revenue this month"
          value={formatMoney(stats.revenueThisMonthMinor, stats.currency)}
          icon={Wallet}
          deltaPercent={percentChange(stats.revenueThisMonthMinor, stats.revenueLastMonthMinor)}
        />
        <StatCard
          label="Rating"
          value={stats.ratingCount > 0 ? stats.ratingAverage.toFixed(2) : "—"}
          icon={Star}
          hint={`${stats.ratingCount} review${stats.ratingCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Cancelled this month"
          value={String(stats.cancelledThisMonth)}
          icon={CalendarX2}
          hint={`${stats.completedThisMonth} completed`}
          invertDelta
        />
      </div>

      {stats.pendingReviews > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="flex items-center gap-2 text-sm">
              <MessageSquareWarning aria-hidden className="size-4 text-warning" />
              {stats.pendingReviews} review{stats.pendingReviews === 1 ? "" : "s"} awaiting your
              reply.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/doctor/reviews">Respond</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Revenue, last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          {series.some((point) => point.totalMinor > 0) ? (
            <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily revenue chart">
              {series.map((point) => {
                const heightPercent = (point.totalMinor / peakRevenue) * 100;
                return (
                  <div key={point.date} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary/80 transition-colors hover:bg-primary"
                      style={{ height: `${Math.max(2, heightPercent)}%` }}
                      title={`${point.date}: ${formatMoney(point.totalMinor, stats.currency)}`}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {point.date.slice(8)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No completed, paid appointments in this period yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Today&rsquo;s schedule</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/doctor/appointments">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {today.length > 0 ? (
            <ul className="divide-y">
              {today.map((appointment) => (
                <li key={appointment.id} className="flex items-center gap-4 py-3 first:pt-0">
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground"
                  >
                    {appointment.patientInitials}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{appointment.patientName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {appointment.reasonForVisit ?? "No reason given"}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {formatInTimezone(new Date(appointment.startsAt), timezone, "HH:mm")}
                    </p>
                    <Badge variant={STATUS_VARIANT[appointment.status] ?? "secondary"}>
                      {appointment.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing booked today. Your next appointment will appear here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
