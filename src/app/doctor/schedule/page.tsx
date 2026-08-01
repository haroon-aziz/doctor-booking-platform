import type { Metadata } from "next";

import { ScheduleEditor } from "@/features/doctor-portal/components/schedule-editor";
import { listAvailabilityRules } from "@/features/doctor-portal/repositories/doctor-portal.repository";
import { requireDoctor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = {
  title: "Schedule",
  robots: { index: false, follow: false },
};

export default async function DoctorSchedulePage() {
  const { user, doctorId } = await requireDoctor();

  const [rules, doctor] = await Promise.all([
    listAvailabilityRules(doctorId),
    prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        supportsInPerson: true,
        supportsVideo: true,
        supportsPhone: true,
        clinics: { include: { clinic: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const supportedModes = [
    ...(doctor?.supportsInPerson ? ["IN_PERSON"] : []),
    ...(doctor?.supportsVideo ? ["VIDEO"] : []),
    ...(doctor?.supportsPhone ? ["PHONE"] : []),
  ];

  const clinics = (doctor?.clinics ?? []).map((link) => ({
    id: link.clinic.id,
    name: link.clinic.name,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly schedule</h1>
        <p className="text-muted-foreground">
          Set the hours you work each day. Times are in {user.timezone.replace("_", " ")}.
        </p>
      </header>

      <ScheduleEditor
        initialRules={rules}
        clinics={clinics}
        supportedModes={supportedModes.length > 0 ? supportedModes : ["IN_PERSON"]}
      />
    </div>
  );
}
