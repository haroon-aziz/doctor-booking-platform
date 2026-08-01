import { describe, expect, it } from "vitest";

import { redisOptions } from "@/lib/redis/client";

/**
 * Configuration invariants for the Redis client.
 *
 * These exist because the combination that broke was silent: with
 * `lazyConnect` on and the offline queue off, the *first* command after boot is
 * rejected with "Stream isn't writeable" while the socket is still being
 * established. The rate limiter fails open and the booking service reports a
 * generic error, so nothing crashes — slot locking simply never works.
 *
 * A unit test cannot catch that by exercising Redis, but it can pin the
 * configuration that caused it.
 */
describe("redis client configuration", () => {
  it("queues commands while the lazy connection is being established", () => {
    if (redisOptions.lazyConnect) {
      expect(
        redisOptions.enableOfflineQueue,
        "lazyConnect requires enableOfflineQueue, or the first command is rejected",
      ).toBe(true);
    }
  });

  it("bounds per-request retries so a dead Redis fails fast", () => {
    expect(redisOptions.maxRetriesPerRequest).toBeGreaterThan(0);
    expect(redisOptions.maxRetriesPerRequest).toBeLessThanOrEqual(3);
  });

  it("bounds the reconnect loop instead of retrying forever", () => {
    const strategy = redisOptions.retryStrategy;
    expect(strategy).toBeTypeOf("function");
    // Past the cap the strategy must return null to stop reconnecting.
    expect(strategy?.(999)).toBeNull();
    // Early attempts still back off and retry.
    expect(strategy?.(1)).toBeTypeOf("number");
  });

  it("sets a connect timeout", () => {
    expect(redisOptions.connectTimeout).toBeGreaterThan(0);
  });
});
