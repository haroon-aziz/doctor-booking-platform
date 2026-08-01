import type { AuditAction, UserRole } from "@/generated/prisma/enums";
import { Prisma, prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Audit trail.
 *
 * A healthcare platform has to be able to answer "who changed this record, when,
 * and what did it look like before?" long after the fact. Two streams are kept
 * deliberately separate:
 *
 *   * `AuditLog`  — immutable, field-level, for compliance and incident review.
 *   * `AdminLog`  — a human-readable activity feed for the admin UI.
 *
 * Writing an audit entry must never break the operation it records, so failures
 * are logged and swallowed. Losing an audit line is bad; rolling back a
 * completed doctor verification because the audit insert failed is worse.
 */

/** Field names whose values are never written to the audit trail. */
const REDACTED_FIELDS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "secret",
  "apiKey",
  "patientToken",
  "doctorToken",
]);

export interface AuditContext {
  actorId?: string | null;
  actorRole?: UserRole | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry extends AuditContext {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Reduces a before/after pair to only the fields that actually changed, with
 * sensitive values masked. Storing whole row snapshots would bloat the table
 * and duplicate patient data across it.
 */
export function diffChanges(
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> | null {
  if (!before && !after) return null;

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];

    const normalise = (value: unknown) =>
      value instanceof Date ? value.toISOString() : value;

    if (JSON.stringify(normalise(from)) === JSON.stringify(normalise(to))) continue;

    changes[key] = REDACTED_FIELDS.has(key)
      ? { from: from === undefined ? undefined : "[redacted]", to: "[redacted]" }
      : { from: normalise(from), to: normalise(to) };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        // Prisma's Json input type does not accept a bare Record, so the
        // already-redacted diff is narrowed to its InputJsonValue form.
        changes: (diffChanges(entry.before, entry.after) ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, action: entry.action, entityType: entry.entityType },
      "Failed to write audit log entry",
    );
  }
}

export interface AdminActivity {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function recordAdminActivity(activity: AdminActivity): Promise<void> {
  try {
    await prisma.adminLog.create({
      data: {
        adminId: activity.adminId,
        action: activity.action,
        targetType: activity.targetType,
        targetId: activity.targetId ?? null,
        description: activity.description,
        metadata: (activity.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: activity.action }, "Failed to write admin log entry");
  }
}
