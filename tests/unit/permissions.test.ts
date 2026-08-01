import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  canAll,
  canAny,
  type Permission,
} from "@/lib/auth/permissions";
import type { UserRole } from "@/generated/prisma/enums";

const ROLES: UserRole[] = ["PATIENT", "DOCTOR", "ADMIN", "SUPER_ADMIN"];

describe("role-based access control", () => {
  it("defines a permission set for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it("grants no permission outside the declared catalogue", () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  describe("patients", () => {
    it("can manage their own care", () => {
      expect(can("PATIENT", "appointment:book")).toBe(true);
      expect(can("PATIENT", "medical_record:read:own")).toBe(true);
      expect(can("PATIENT", "review:create:own")).toBe(true);
    });

    it("cannot touch anything clinical or administrative", () => {
      expect(can("PATIENT", "prescription:create")).toBe(false);
      expect(can("PATIENT", "doctor:verify")).toBe(false);
      expect(can("PATIENT", "user:suspend")).toBe(false);
      expect(can("PATIENT", "payment:refund")).toBe(false);
    });
  });

  describe("doctors", () => {
    it("can run their own practice", () => {
      expect(can("DOCTOR", "schedule:manage:own")).toBe(true);
      expect(can("DOCTOR", "prescription:create")).toBe(true);
      expect(can("DOCTOR", "revenue:read:own")).toBe(true);
    });

    it("cannot self-verify or administer the platform", () => {
      expect(can("DOCTOR", "doctor:verify")).toBe(false);
      expect(can("DOCTOR", "review:moderate")).toBe(false);
      expect(can("DOCTOR", "setting:manage")).toBe(false);
    });
  });

  describe("administrators", () => {
    it("can run verification and moderation", () => {
      expect(can("ADMIN", "doctor:verify")).toBe(true);
      expect(can("ADMIN", "review:moderate")).toBe(true);
      expect(can("ADMIN", "audit_log:read")).toBe(true);
    });

    /**
     * The important boundary in a healthcare product: administrative authority
     * is not clinical authority. An admin must never be able to write a
     * prescription or read a patient history they are not party to.
     */
    it("hold no clinical authority", () => {
      expect(can("ADMIN", "prescription:create")).toBe(false);
      expect(can("ADMIN", "patient_history:read:assigned")).toBe(false);
      expect(can("ADMIN", "medical_record:read:own")).toBe(false);
    });

    it("cannot change system settings or issue refunds", () => {
      expect(can("ADMIN", "setting:manage")).toBe(false);
      expect(can("ADMIN", "payment:refund")).toBe(false);
      expect(can("ADMIN", "admin:manage")).toBe(false);
    });
  });

  describe("super administrators", () => {
    it("extend admin with settings, refunds and admin management", () => {
      expect(can("SUPER_ADMIN", "setting:manage")).toBe(true);
      expect(can("SUPER_ADMIN", "payment:refund")).toBe(true);
      expect(can("SUPER_ADMIN", "admin:manage")).toBe(true);
    });

    it("inherit every admin permission", () => {
      for (const permission of ROLE_PERMISSIONS.ADMIN) {
        expect(can("SUPER_ADMIN", permission)).toBe(true);
      }
    });

    it("still hold no clinical authority", () => {
      expect(can("SUPER_ADMIN", "prescription:create")).toBe(false);
    });
  });

  it("keeps patient and doctor permissions disjoint", () => {
    const patient = new Set<Permission>(ROLE_PERMISSIONS.PATIENT);
    const overlap = ROLE_PERMISSIONS.DOCTOR.filter((permission) => patient.has(permission));
    expect(overlap).toEqual([]);
  });

  describe("combinators", () => {
    it("canAny succeeds when at least one is granted", () => {
      expect(canAny("PATIENT", ["doctor:verify", "appointment:book"])).toBe(true);
      expect(canAny("PATIENT", ["doctor:verify", "setting:manage"])).toBe(false);
    });

    it("canAll requires every permission", () => {
      expect(canAll("DOCTOR", ["prescription:create", "schedule:manage:own"])).toBe(true);
      expect(canAll("DOCTOR", ["prescription:create", "doctor:verify"])).toBe(false);
    });

    it("treats an empty list as vacuously true", () => {
      expect(canAll("PATIENT", [])).toBe(true);
      expect(canAny("PATIENT", [])).toBe(false);
    });
  });
});
