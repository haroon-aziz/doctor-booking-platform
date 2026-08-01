import { redis } from "@/lib/redis/client";
import { logger } from "@/lib/logger";

/**
 * Fixed-window rate limiting backed by Redis.
 *
 * INCR + EXPIRE in a single pipeline keeps the window atomic across processes,
 * which a per-instance in-memory counter cannot do.
 *
 * Fail-open vs fail-closed is decided per call site: sign-in must fail *closed*
 * (a Redis outage must not become an open door for credential stuffing), while
 * read-only browsing endpoints fail *open* so a cache blip does not take the
 * marketplace down.
 */

export interface RateLimitOptions {
  key: string;
  max: number;
  windowSeconds: number;
  failClosed?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

export async function rateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, max, windowSeconds, failClosed = false } = options;
  const redisKey = `ratelimit:${key}`;

  try {
    const replies = await redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSeconds, "NX")
      .exec();

    // ioredis returns null when the transaction was aborted; treat that the
    // same as an outage rather than silently counting it as a first request.
    if (replies === null) throw new Error("Redis transaction aborted");

    const incrReply = replies[0];
    if (incrReply?.[0]) throw incrReply[0];

    const count = Number(incrReply?.[1] ?? 0);
    const ttl = await redis.ttl(redisKey);

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      limit: max,
    };
  } catch (error) {
    logger.error({ err: error, key }, "Rate limiter unavailable");
    return {
      allowed: !failClosed,
      remaining: 0,
      retryAfterSeconds: windowSeconds,
      limit: max,
    };
  }
}

/** Clears a counter — used after a successful sign-in. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await redis.del(`ratelimit:${key}`);
  } catch (error) {
    logger.warn({ err: error, key }, "Could not reset rate limit counter");
  }
}

/**
 * Best-effort client identity for anonymous limits. `x-forwarded-for` is only
 * trustworthy behind a proxy that overwrites it; the deployment guide covers
 * configuring that.
 */
export function clientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? "unknown";
  return ip;
}
