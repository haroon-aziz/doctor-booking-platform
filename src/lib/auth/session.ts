import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "@/lib/auth/auth";
import { can, type Permission } from "@/lib/auth/permissions";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors/app-error";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

/**
 * Server-side session access.
 *
 * `getCurrentUser` is wrapped in React's `cache`, so a page that checks
 * authorisation in the layout, again in the page, and once more in three
 * components still performs a single session read per request.
 */

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  timezone: string;
}

/**
 * Better Auth types additional fields loosely, so they are narrowed once here
 * rather than cast at every call site.
 */
function normalise(user: Record<string, unknown>): CurrentUser {
  return {
    id: String(user.id),
    name: String(user.name ?? ""),
    email: String(user.email ?? ""),
    emailVerified: Boolean(user.emailVerified),
    image: typeof user.image === "string" ? user.image : null,
    role: (user.role as UserRole) ?? "PATIENT",
    status: (user.status as UserStatus) ?? "PENDING_VERIFICATION",
    timezone: typeof user.timezone === "string" ? user.timezone : "Asia/Karachi",
  };
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return normalise(session.user as unknown as Record<string, unknown>);
});

/** Throws when nobody is signed in, or when the account cannot be used. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();

  if (user.status === "SUSPENDED") {
    throw new ForbiddenError("This account has been suspended. Contact support to appeal.");
  }
  if (user.status === "DEACTIVATED") {
    throw new ForbiddenError("This account has been deactivated.");
  }

  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new ForbiddenError("Your account does not have access to this area.", {
      required: roles,
      actual: user.role,
    });
  }
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new ForbiddenError("You do not have permission to do this.", {
      permission,
      role: user.role,
    });
  }
  return user;
}

/**
 * The patient record for the signed-in user. Separated from `requireUser`
 * because most patient-facing queries key off `patientId`, not `userId`.
 */
export async function requirePatient(): Promise<{ user: CurrentUser; patientId: string }> {
  const user = await requireRole("PATIENT");
  const { prisma } = await import("@/lib/db/prisma");

  const patient = await prisma.patient.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  if (!patient) throw new ForbiddenError("No patient profile is attached to this account.");
  return { user, patientId: patient.id };
}

export async function requireDoctor(): Promise<{ user: CurrentUser; doctorId: string }> {
  const user = await requireRole("DOCTOR");
  const { prisma } = await import("@/lib/db/prisma");

  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.id },
    select: { id: true, verificationStatus: true },
  });

  if (!doctor) throw new ForbiddenError("No doctor profile is attached to this account.");
  if (doctor.verificationStatus !== "APPROVED") {
    throw new ForbiddenError("Your profile is still awaiting verification.");
  }

  return { user, doctorId: doctor.id };
}
