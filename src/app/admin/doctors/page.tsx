import { BadgeCheck, FileText, GraduationCap, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerificationActions } from "@/features/admin/components/verification-actions";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = {
  title: "Doctor verification",
  robots: { index: false, follow: false },
};

export default async function AdminDoctorsPage() {
  await requirePermission("doctor:verify");

  const pending = await prisma.doctor.findMany({
    where: { verificationStatus: { in: ["PENDING", "UNDER_REVIEW", "RESUBMIT_REQUIRED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { name: true, email: true, phone: true, createdAt: true } },
      specialties: { include: { specialty: { select: { name: true } } } },
      education: { orderBy: { endYear: "desc" } },
      certificates: true,
      clinics: { include: { clinic: { select: { name: true, city: true } } } },
      verification: {
        include: { documents: { include: { file: { select: { originalName: true, type: true } } } } },
      },
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Doctor verification</h1>
        <p className="text-muted-foreground">
          Check each licence and qualification before approving. Approved doctors become
          immediately bookable by patients.
        </p>
      </header>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BadgeCheck aria-hidden className="size-8 text-success" />
            <p className="font-medium">The queue is clear</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Every submitted application has been reviewed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {pending.map((doctor) => (
            <li key={doctor.id}>
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {doctor.title} {doctor.user.name}
                      <Badge
                        variant={
                          doctor.verificationStatus === "RESUBMIT_REQUIRED" ? "warning" : "secondary"
                        }
                      >
                        {doctor.verificationStatus.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {doctor.specialties.map((link) => link.specialty.name).join(", ") ||
                        "No specialty declared"}
                      {" · "}
                      {doctor.yearsOfExperience} yrs experience
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Applied {doctor.user.createdAt.toLocaleDateString("en-GB")}
                  </span>
                </CardHeader>

                <CardContent className="space-y-5">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="flex items-start gap-2">
                      <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-muted-foreground">Licence</dt>
                        <dd className="font-medium">{doctor.licenseNumber}</dd>
                        <dd className="text-xs text-muted-foreground">
                          {doctor.licenseAuthority ?? "Authority not stated"}
                          {doctor.licenseExpiresAt &&
                            ` · expires ${doctor.licenseExpiresAt.toLocaleDateString("en-GB")}`}
                        </dd>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-muted-foreground">Contact</dt>
                        <dd className="font-medium">{doctor.user.email}</dd>
                        {doctor.user.phone && (
                          <dd className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone aria-hidden className="size-3" />
                            {doctor.user.phone}
                          </dd>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <GraduationCap aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-muted-foreground">Education</dt>
                        {doctor.education.length > 0 ? (
                          doctor.education.map((entry) => (
                            <dd key={entry.id} className="font-medium">
                              {entry.degree}, {entry.institution}
                              {entry.endYear ? ` (${entry.endYear})` : ""}
                            </dd>
                          ))
                        ) : (
                          <dd className="text-destructive">None provided</dd>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-muted-foreground">Practice</dt>
                        {doctor.clinics.map((link) => (
                          <dd key={link.clinicId} className="font-medium">
                            {link.clinic.name}, {link.clinic.city}
                          </dd>
                        ))}
                        <dd className="text-xs text-muted-foreground">
                          From {formatMoney(
                            Math.min(
                              ...[
                                doctor.supportsInPerson ? doctor.inPersonFeeMinor : Infinity,
                                doctor.supportsVideo ? doctor.videoFeeMinor : Infinity,
                                doctor.supportsPhone ? doctor.phoneFeeMinor : Infinity,
                              ].filter((fee) => Number.isFinite(fee)),
                            ),
                            doctor.currency,
                          )}
                        </dd>
                      </div>
                    </div>
                  </dl>

                  <div>
                    <p className="mb-2 text-sm font-medium">Submitted documents</p>
                    {doctor.verification && doctor.verification.documents.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {doctor.verification.documents.map((document) => (
                          <li key={document.id}>
                            <Badge variant="outline">
                              <FileText aria-hidden />
                              {document.type.replace(/_/g, " ").toLowerCase()}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-warning">
                        No documents uploaded — request them before approving.
                      </p>
                    )}
                  </div>

                  {doctor.verification?.rejectionReason && (
                    <div className="rounded-lg border-l-2 border-destructive bg-muted/50 p-3 text-sm">
                      <p className="font-medium">Previous rejection</p>
                      <p className="text-muted-foreground">
                        {doctor.verification.rejectionReason}
                      </p>
                    </div>
                  )}

                  <VerificationActions doctorId={doctor.id} doctorName={doctor.user.name} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
