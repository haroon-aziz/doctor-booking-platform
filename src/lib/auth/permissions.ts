import type { UserRole } from "@/generated/prisma/enums";

/**
 * Role-based access control.
 *
 * Permissions are declared as data rather than scattered through `if` blocks,
 * so the full authority of every role is auditable in one screen — which is
 * what a healthcare deployment will be asked to produce.
 */

export const PERMISSIONS = [
  // Patient
  "appointment:book",
  "appointment:cancel:own",
  "appointment:reschedule:own",
  "appointment:read:own",
  "medical_record:read:own",
  "medical_record:upload:own",
  "review:create:own",
  "doctor:save",

  // Doctor
  "schedule:manage:own",
  "appointment:read:assigned",
  "appointment:complete:assigned",
  "appointment:cancel:assigned",
  "prescription:create",
  "patient_history:read:assigned",
  "review:reply:own",
  "doctor_profile:update:own",
  "revenue:read:own",

  // Admin
  "doctor:verify",
  "doctor:reject",
  "user:read:any",
  "user:suspend",
  "user:reinstate",
  "specialty:manage",
  "hospital:manage",
  "review:moderate",
  "coupon:manage",
  "ticket:manage",
  "report:read",
  "audit_log:read",

  // Super admin only
  "setting:manage",
  "admin:manage",
  "payment:refund",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PATIENT_PERMISSIONS: Permission[] = [
  "appointment:book",
  "appointment:cancel:own",
  "appointment:reschedule:own",
  "appointment:read:own",
  "medical_record:read:own",
  "medical_record:upload:own",
  "review:create:own",
  "doctor:save",
];

const DOCTOR_PERMISSIONS: Permission[] = [
  "schedule:manage:own",
  "appointment:read:assigned",
  "appointment:complete:assigned",
  "appointment:cancel:assigned",
  "prescription:create",
  "patient_history:read:assigned",
  "review:reply:own",
  "doctor_profile:update:own",
  "revenue:read:own",
];

const ADMIN_PERMISSIONS: Permission[] = [
  "doctor:verify",
  "doctor:reject",
  "user:read:any",
  "user:suspend",
  "user:reinstate",
  "specialty:manage",
  "hospital:manage",
  "review:moderate",
  "coupon:manage",
  "ticket:manage",
  "report:read",
  "audit_log:read",
];

/**
 * Deliberately not hierarchical: an admin is not a super-set of a doctor. An
 * administrator has no clinical authority — they must never be able to write a
 * prescription or read a patient history they are not party to.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  PATIENT: PATIENT_PERMISSIONS,
  DOCTOR: DOCTOR_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  SUPER_ADMIN: [...ADMIN_PERMISSIONS, "setting:manage", "admin:manage", "payment:refund"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function canAll(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((permission) => can(role, permission));
}

/** Landing page for each role immediately after sign-in. */
export const ROLE_HOME: Record<UserRole, string> = {
  PATIENT: "/appointments",
  DOCTOR: "/doctor/dashboard",
  ADMIN: "/admin",
  SUPER_ADMIN: "/admin",
};

/** Route prefixes each role may enter. Enforced by middleware. */
export const ROLE_ROUTE_PREFIXES: Record<UserRole, string[]> = {
  PATIENT: ["/appointments", "/records", "/book", "/consultation", "/account", "/support"],
  DOCTOR: ["/doctor", "/consultation", "/account", "/support"],
  ADMIN: ["/admin", "/account", "/support"],
  SUPER_ADMIN: ["/admin", "/account", "/support"],
};
