"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getEmailAdapter } from "@/adapters/email";
import { syncDoctor } from "@/features/search/services/doctor-index";
import { runAction, type ActionResult } from "@/lib/actions/action-result";
import { recordAdminActivity, recordAudit } from "@/lib/audit/audit-log";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger";
import { clientIdentifier } from "@/lib/rate-limit";

/**
 * Doctor verification.
 *
 * This is the platform's single most consequential administrative action: it
 * decides who may present themselves to patients as a licensed clinician. Every
 * decision is therefore audited with the actor, the reason, and the before/after
 * state, and rejection *requires* a written reason.
 */

const approveSchema = z.object({
  doctorId: z.string().min(1),
  note: z.string().max(1_000).optional().or(z.literal("")),
});

const rejectSchema = z.object({
  doctorId: z.string().min(1),
  // Not optional: a doctor is entitled to know why they were refused, and an
  // unexplained rejection is impossible to appeal or audit.
  reason: z.string().min(10, "Give a reason of at least 10 characters.").max(1_000),
  allowResubmit: z.boolean().default(true),
});

async function auditContext() {
  const requestHeaders = await headers();
  return {
    ipAddress: clientIdentifier(requestHeaders),
    userAgent: requestHeaders.get("user-agent"),
  };
}

export async function approveDoctorAction(
  input: unknown,
): Promise<ActionResult<{ doctorId: string }>> {
  return runAction("approveDoctor", async () => {
    const parsed = approveSchema.parse(input);
    const admin = await requirePermission("doctor:verify");

    const doctor = await prisma.doctor.findUnique({
      where: { id: parsed.doctorId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        verification: true,
      },
    });

    if (!doctor) throw new NotFoundError("Doctor");
    if (doctor.verificationStatus === "APPROVED") {
      throw new ConflictError("This doctor is already approved.");
    }

    const before = {
      verificationStatus: doctor.verificationStatus,
      verifiedAt: doctor.verifiedAt,
    };

    await prisma.$transaction(async (tx) => {
      await tx.doctor.update({
        where: { id: doctor.id },
        data: { verificationStatus: "APPROVED", verifiedAt: new Date() },
      });

      await tx.doctorVerification.upsert({
        where: { doctorId: doctor.id },
        create: {
          doctorId: doctor.id,
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedById: admin.id,
          internalNotes: parsed.note || null,
        },
        update: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedById: admin.id,
          internalNotes: parsed.note || null,
          rejectionReason: null,
        },
      });

      await tx.user.update({ where: { id: doctor.userId }, data: { status: "ACTIVE" } });

      await tx.notification.create({
        data: {
          userId: doctor.userId,
          type: "DOCTOR_APPROVED",
          channel: "IN_APP",
          title: "Your profile has been approved",
          body: "Your credentials have been verified. Set your weekly schedule to start receiving bookings.",
          actionUrl: "/doctor/schedule",
        },
      });
    });

    const context = await auditContext();
    await Promise.all([
      recordAudit({
        actorId: admin.id,
        actorRole: admin.role,
        action: "APPROVE",
        entityType: "Doctor",
        entityId: doctor.id,
        before,
        after: { verificationStatus: "APPROVED", verifiedAt: new Date() },
        ...context,
      }),
      recordAdminActivity({
        adminId: admin.id,
        action: "doctor.approve",
        targetType: "Doctor",
        targetId: doctor.id,
        description: `Approved ${doctor.user.name} (${doctor.licenseNumber})`,
        metadata: parsed.note ? { note: parsed.note } : undefined,
      }),
    ]);

    const email = await getEmailAdapter().send({
      to: doctor.user.email,
      subject: "Your MediBook profile has been approved",
      html: `<p>Hello ${doctor.user.name},</p><p>Your credentials have been verified and your profile is now live. Set your weekly schedule to start receiving bookings.</p><p><a href="${env.APP_URL}/doctor/schedule">Set your schedule</a></p>`,
      text: `Hello ${doctor.user.name},\n\nYour credentials have been verified and your profile is now live.\n\nSet your schedule: ${env.APP_URL}/doctor/schedule`,
    });
    if (!email.ok) {
      logger.warn({ doctorId: doctor.id }, "Approval email could not be delivered");
    }

    // Newly approved doctors must appear in search immediately; a failure
    // here is logged inside syncDoctor and never blocks the approval.
    await syncDoctor(doctor.id);

    revalidatePath("/admin/doctors");
    revalidatePath("/doctors");

    return { doctorId: doctor.id };
  });
}

export async function rejectDoctorAction(
  input: unknown,
): Promise<ActionResult<{ doctorId: string }>> {
  return runAction("rejectDoctor", async () => {
    const parsed = rejectSchema.parse(input);
    const admin = await requirePermission("doctor:reject");

    const doctor = await prisma.doctor.findUnique({
      where: { id: parsed.doctorId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!doctor) throw new NotFoundError("Doctor");

    const status = parsed.allowResubmit ? "RESUBMIT_REQUIRED" : "REJECTED";
    const before = { verificationStatus: doctor.verificationStatus };

    await prisma.$transaction(async (tx) => {
      await tx.doctor.update({
        where: { id: doctor.id },
        // A rejected profile must also stop being bookable, not merely lose its
        // badge — otherwise existing slots stay open to patients.
        data: { verificationStatus: status, verifiedAt: null, isAcceptingPatients: false },
      });

      await tx.doctorVerification.upsert({
        where: { doctorId: doctor.id },
        create: {
          doctorId: doctor.id,
          status,
          reviewedAt: new Date(),
          reviewedById: admin.id,
          rejectionReason: parsed.reason,
        },
        update: {
          status,
          reviewedAt: new Date(),
          reviewedById: admin.id,
          rejectionReason: parsed.reason,
        },
      });

      await tx.appointmentSlot.deleteMany({
        where: { doctorId: doctor.id, status: "AVAILABLE", startsAt: { gt: new Date() } },
      });

      await tx.notification.create({
        data: {
          userId: doctor.userId,
          type: "DOCTOR_REJECTED",
          channel: "IN_APP",
          title: parsed.allowResubmit
            ? "More information needed"
            : "Your application was not approved",
          body: parsed.reason,
          actionUrl: "/doctor/profile",
        },
      });
    });

    const context = await auditContext();
    await Promise.all([
      recordAudit({
        actorId: admin.id,
        actorRole: admin.role,
        action: "REJECT",
        entityType: "Doctor",
        entityId: doctor.id,
        before,
        after: { verificationStatus: status, rejectionReason: parsed.reason },
        ...context,
      }),
      recordAdminActivity({
        adminId: admin.id,
        action: "doctor.reject",
        targetType: "Doctor",
        targetId: doctor.id,
        description: `Rejected ${doctor.user.name}: ${parsed.reason.slice(0, 120)}`,
        metadata: { allowResubmit: parsed.allowResubmit },
      }),
    ]);

    await getEmailAdapter().send({
      to: doctor.user.email,
      subject: parsed.allowResubmit
        ? "More information needed for your MediBook application"
        : "Your MediBook application was not approved",
      html: `<p>Hello ${doctor.user.name},</p><p>${parsed.reason}</p>${
        parsed.allowResubmit
          ? `<p>You can update your documents and resubmit: <a href="${env.APP_URL}/doctor/profile">${env.APP_URL}/doctor/profile</a></p>`
          : "<p>If you believe this is a mistake, please contact support.</p>"
      }`,
      text: `Hello ${doctor.user.name},\n\n${parsed.reason}\n\n${
        parsed.allowResubmit
          ? `Update your documents and resubmit: ${env.APP_URL}/doctor/profile`
          : "If you believe this is a mistake, please contact support."
      }`,
    });

    // Removes the doctor from the index; syncDoctor deletes when unapproved.
    await syncDoctor(doctor.id);

    revalidatePath("/admin/doctors");
    revalidatePath("/doctors");

    return { doctorId: doctor.id };
  });
}
