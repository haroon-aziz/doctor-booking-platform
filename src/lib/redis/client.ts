import Redis, { type Redis as RedisClient, type RedisOptions } from "ioredis";

import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

/**
 * Redis is load-bearing for the booking engine (slot locks) and rate limiting,
 * so the client is configured to fail fast and loudly rather than to queue
 * commands indefinitely behind a dead socket — a silent queue would let a
 * "lock acquired" call hang until the request times out, which reads to the
 * caller like a successful hold.
 */

/** Bounded so a missing Redis does not retry forever. */
const MAX_RECONNECT_ATTEMPTS = 10;

const globalForRedis = globalThis as unknown as { redis?: RedisClient };

/** Exported so configuration invariants can be unit-tested without connecting. */
export const redisOptions = {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  /**
   * Must stay `true` whenever `lazyConnect` is on. With `lazyConnect` the socket
   * opens on the first command, and with the queue disabled that command is
   * rejected ("Stream isn't writeable") while the connection is still forming.
   * Bounded by `maxRetriesPerRequest` and `connectTimeout`, so a dead Redis
   * still fails fast rather than queueing forever.
   */
  enableOfflineQueue: true,
  // Connect on first command, not on import. Eager connection means any
  // module that merely *imports* this one opens a socket — which floods
  // `next build` with connection errors while it collects page data, and
  // couples module loading to infrastructure availability.
  lazyConnect: true,
  connectTimeout: 5_000,
  /**
   * Stop reconnecting after a bounded number of attempts; an unbounded loop
   * against a Redis that simply is not running floods the log. Returning null
   * ends the loop, and the next command starts a fresh attempt, so the client
   * still recovers once Redis is back.
   */
  retryStrategy: (times) => {
    if (times > MAX_RECONNECT_ATTEMPTS) return null;
    return Math.min(times * 200, 3_000);
  },
} satisfies RedisOptions;

function createRedisClient(): RedisClient {
  const client = new Redis(env.REDIS_URL, redisOptions);

  // Identical connection failures are collapsed into one line plus a periodic
  // reminder, so a missing Redis is obvious without drowning the log.
  let consecutiveErrors = 0;

  client.on("error", (error: Error) => {
    consecutiveErrors += 1;

    if (consecutiveErrors === 1) {
      logger.error({ err: error }, "Redis connection error");
    } else if (consecutiveErrors % 50 === 0) {
      logger.error(
        {
          attempts: consecutiveErrors,
          code: (error as NodeJS.ErrnoException).code,
        },
        "Redis still unreachable",
      );
    }
  });

  client.on("ready", () => {
    if (consecutiveErrors > 0) {
      logger.info(
        { afterAttempts: consecutiveErrors },
        "Redis connection recovered",
      );
    } else {
      logger.info("Redis connection ready");
    }
    consecutiveErrors = 0;
  });

  return client;
}

export const redis: RedisClient = globalForRedis.redis ?? createRedisClient();

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

/** True when Redis is reachable — used by the health endpoint. */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === "PONG";
  } catch {
    return false;
  }
}

export type { RedisClient };
