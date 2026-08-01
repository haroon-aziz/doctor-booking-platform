import { randomUUID } from "node:crypto";

import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis/client";

/**
 * Distributed slot locks.
 *
 * When a patient reaches checkout the slot is held so nobody else can take it
 * while they enter payment details. The hold lives in Redis because it must
 * expire on its own — if the patient closes the tab, the slot has to come back
 * without anything running to clean it up.
 *
 * Each hold carries a random token. Release and extend are compare-and-swap
 * against that token via Lua, so a caller can only ever free *its own* hold.
 * Without that check, a hold that expired mid-request would be deleted by its
 * original owner just after a second patient acquired it — silently handing the
 * slot to two people at once.
 *
 * Redis is the fast path, not the guarantee. The authoritative defence against
 * double-booking is the conditional row update plus the
 * `(doctorId, startsAt, mode)` unique index in Postgres.
 */

const HOLD_PREFIX = "slot:hold:";

/** Delete the key only if it still holds our token. */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/** Extend the TTL only if it still holds our token. */
const EXTEND_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

export interface SlotHold {
  slotId: string;
  token: string;
  userId: string;
  expiresAt: Date;
  ttlSeconds: number;
}

export type AcquireResult =
  | { acquired: true; hold: SlotHold }
  | { acquired: false; heldByCurrentUser: boolean; retryAfterSeconds: number };

function holdKey(slotId: string): string {
  return `${HOLD_PREFIX}${slotId}`;
}

/** Stored value is `userId:token` so the owner is visible without a second read. */
function encode(userId: string, token: string): string {
  return `${userId}:${token}`;
}

function decode(value: string): { userId: string; token: string } | null {
  const separator = value.indexOf(":");
  if (separator === -1) return null;
  return { userId: value.slice(0, separator), token: value.slice(separator + 1) };
}

/**
 * Attempts to hold a slot. Re-entrant for the same user: a patient who reloads
 * checkout gets their existing hold back rather than being told the slot is
 * taken by someone else.
 */
export async function acquireSlotHold(
  slotId: string,
  userId: string,
  ttlSeconds = env.SLOT_HOLD_TTL_SECONDS,
): Promise<AcquireResult> {
  const token = randomUUID();
  const key = holdKey(slotId);

  const result = await redis.set(key, encode(userId, token), "EX", ttlSeconds, "NX");

  if (result === "OK") {
    logger.debug({ slotId, userId, ttlSeconds }, "Slot hold acquired");
    return {
      acquired: true,
      hold: {
        slotId,
        token,
        userId,
        ttlSeconds,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    };
  }

  const existing = await redis.get(key);
  const ttl = await redis.ttl(key);
  const owner = existing ? decode(existing) : null;

  if (owner?.userId === userId) {
    // Same patient, same slot — refresh rather than reject.
    await redis.set(key, encode(userId, owner.token), "EX", ttlSeconds, "XX");
    return {
      acquired: true,
      hold: {
        slotId,
        token: owner.token,
        userId,
        ttlSeconds,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    };
  }

  return {
    acquired: false,
    heldByCurrentUser: false,
    retryAfterSeconds: ttl > 0 ? ttl : ttlSeconds,
  };
}

export async function releaseSlotHold(
  slotId: string,
  userId: string,
  token: string,
): Promise<boolean> {
  const released = await redis.eval(RELEASE_SCRIPT, 1, holdKey(slotId), encode(userId, token));
  const ok = Number(released) === 1;
  if (ok) logger.debug({ slotId, userId }, "Slot hold released");
  return ok;
}

export async function extendSlotHold(
  slotId: string,
  userId: string,
  token: string,
  ttlSeconds = env.SLOT_HOLD_TTL_SECONDS,
): Promise<boolean> {
  const extended = await redis.eval(
    EXTEND_SCRIPT,
    1,
    holdKey(slotId),
    encode(userId, token),
    String(ttlSeconds),
  );
  return Number(extended) === 1;
}

/** Verifies a hold is still live and owned by this user/token pair. */
export async function verifySlotHold(
  slotId: string,
  userId: string,
  token: string,
): Promise<boolean> {
  const value = await redis.get(holdKey(slotId));
  return value === encode(userId, token);
}

export async function getSlotHoldTtl(slotId: string): Promise<number> {
  const ttl = await redis.ttl(holdKey(slotId));
  return ttl > 0 ? ttl : 0;
}
