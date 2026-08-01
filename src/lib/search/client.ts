import { Meilisearch } from "meilisearch";

import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

/**
 * Meilisearch client.
 *
 * Constructed lazily for the same reason the Redis client is: importing a
 * module must not open a network connection, or `next build` starts dialling
 * infrastructure while collecting page data.
 */

declare global {
  var __meilisearch__: Meilisearch | undefined;
}

function create(): Meilisearch {
  return new Meilisearch({
    host: env.MEILISEARCH_HOST,
    apiKey: env.MEILISEARCH_MASTER_KEY,
    requestInit: { headers: { "Content-Type": "application/json" } },
  });
}

export function getSearchClient(): Meilisearch {
  // Held on globalThis so HMR reloads in development reuse one client rather
  // than leaking a new connection pool per edit.
  return (globalThis.__meilisearch__ ??= create());
}

export const DOCTOR_INDEX = "doctors";

/**
 * Whether Meilisearch is reachable and the doctor index exists.
 *
 * Cached briefly: search runs on every keystroke of the marketplace filter, and
 * a health probe per request would double the latency it is meant to protect.
 */
let healthCache: { healthy: boolean; checkedAt: number } | undefined;
const HEALTH_TTL_MS = 15_000;

export async function isSearchAvailable(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.checkedAt < HEALTH_TTL_MS) {
    return healthCache.healthy;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);

    const response = await fetch(`${env.MEILISEARCH_HOST}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    const healthy = response.ok;
    healthCache = { healthy, checkedAt: now };
    return healthy;
  } catch {
    healthCache = { healthy: false, checkedAt: now };
    return false;
  }
}

/** Clears the cached probe — used after a reindex or in tests. */
export function resetSearchHealthCache(): void {
  healthCache = undefined;
  logger.debug("Search health cache cleared");
}
