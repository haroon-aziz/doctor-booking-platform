import "@testing-library/jest-dom/vitest";

/**
 * Test environment defaults.
 *
 * The env module validates on first access and would otherwise refuse to load
 * in CI, where no `.env` exists. These values are deliberately non-secret and
 * point at nothing reachable.
 */
// `NODE_ENV` is typed read-only, so it is assigned through the record view.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.MEILISEARCH_MASTER_KEY ??= "test_master_key";
process.env.BETTER_AUTH_SECRET ??= "test_secret_at_least_32_characters_long";
process.env.APP_URL ??= "http://localhost:3000";
process.env.BOOKING_MIN_LEAD_MINUTES ??= "60";
process.env.BOOKING_MAX_ADVANCE_DAYS ??= "90";
process.env.SLOT_HOLD_TTL_SECONDS ??= "600";
