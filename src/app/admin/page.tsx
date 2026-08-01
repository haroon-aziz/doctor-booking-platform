import { BadgeCheck, CalendarCheck, Stethoscope, Users, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Admin overview",
  robots: { index: false, follow: false },
};

export default async function AdminOverviewPage() {
  await requireRole("ADMIN", "SUPER_ADMIN");

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  const [
    totalPatients,
    totalDoctors,
    pendingVerifications,
    appointmentsThisMonth,
    grossThisMonth,
    pendingReviews,
    recentActivity,
  ] = await Promise.all([
    prisma.patient.count({ where: { deletedAt: null } }),
    prisma.doctor.count({ where: { verificationStatus: "APPROVED", deletedAt: null } }),
    prisma.doctor.count({ where: { verificationStatus: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.appointment.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.payment.aggregate({
      where: { status: "SUCCEEDED", paidAt: { gte: monthStart } },
      _sum: { amountMinor: true },
    }),
    prisma.review.count({ where: { status: "PENDING" } }),
    prisma.adminLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { admin: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Platform activity for the current month.</p>
      </header>

      {pendingVerifications > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="flex items-center gap-2 text-sm">
              <BadgeCheck aria-hidden className="size-4 text-warning" />
              {pendingVerifications} doctor{pendingVerifications === 1 ? "" : "s"} awaiting
              verification.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/doctors">Review queue</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Verified doctors" value={String(totalDoctors)} icon={Stethoscope} hint={`${pendingVerifications} pending`} />
        <StatCard label="Patients" value={String(totalPatients)} icon={Users} />
        <StatCard label="Bookings this month" value={String(appointmentsThisMonth)} icon={CalendarCheck} />
        <StatCard
          label="Gross this month"
          value={formatMoney(grossThisMonth._sum.amountMinor ?? 0)}
          icon={Wallet}
          hint="Captured payments only"
        />
      </div>

      {pendingReviews > 0 && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4 text-sm">
            <span>{pendingReviews} review{pendingReviews === 1 ? "" : "s"} awaiting moderation.</span>
            <Badge variant="warning">Moderation queue</Badge>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent administrative activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length > 0 ? (
            <ul className="divide-y">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{entry.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.admin.name} · {entry.action}
                    </p>
                  </div>
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={entry.createdAt.toISOString()}
                  >
                    {entry.createdAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No administrative actions recorded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
