import { z } from "zod";

/**
 * Fail-fast environment validation.
 *
 * This module is server-only: importing it from a client component will leak
 * secrets into the browser bundle. Client-visible configuration belongs in
 * `src/lib/config/public.ts`.
 *
 * Every adapter driver defaults to its offline implementation so a fresh clone
 * boots with nothing but `.env.example` copied to `.env`.
 */

const port = z.coerce.number().int().min(1).max(65_535);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().min(1).default("Doctor Booking Platform"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: port.default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  /**
   * Serves the marketplace from the in-memory demo repository instead of
   * Postgres. Intended for design review and for running the UI before the
   * Docker stack is up; refused in production so it can never ship.
   */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // search -> postgres | meilisearch. Postgres is exact-match only; the
  // Meilisearch driver adds typo tolerance and falls back if the index is down.
  SEARCH_DRIVER: z.enum(["postgres", "meilisearch"]).default("meilisearch"),
  MEILISEARCH_HOST: z.string().url().default("http://localhost:7700"),
  MEILISEARCH_MASTER_KEY: z.string().min(1),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(604_800),
  SESSION_UPDATE_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),

  EMAIL_DRIVER: z.enum(["mock", "smtp"]).default("mock"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("no-reply@localhost"),

  SMS_DRIVER: z.enum(["mock", "twilio"]).default("mock"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  PAYMENT_DRIVER: z
    .enum(["mock", "stripe", "jazzcash", "easypaisa", "paypal"])
    .default("mock"),
  PAYMENT_CURRENCY: z.string().length(3).default("PKR"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  JAZZCASH_MERCHANT_ID: z.string().optional(),
  JAZZCASH_PASSWORD: z.string().optional(),
  JAZZCASH_INTEGRITY_SALT: z.string().optional(),
  EASYPAISA_STORE_ID: z.string().optional(),
  EASYPAISA_ACCOUNT_NUMBER: z.string().optional(),
  EASYPAISA_HASH_KEY: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),

  VIDEO_DRIVER: z.enum(["mock", "daily", "zoom", "meet"]).default("mock"),
  DAILY_API_KEY: z.string().optional(),
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  GOOGLE_MEET_CLIENT_ID: z.string().optional(),
  GOOGLE_MEET_CLIENT_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage/uploads"),
  STORAGE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  AI_DRIVER: z.enum(["ollama", "fallback"]).default("ollama"),
  OLLAMA_HOST: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.2"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  SLOT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  BOOKING_DEFAULT_TIMEZONE: z.string().default("Asia/Karachi"),
  BOOKING_MAX_ADVANCE_DAYS: z.coerce.number().int().positive().default(90),
  BOOKING_MIN_LEAD_MINUTES: z.coerce.number().int().nonnegative().default(60),

  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_API_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * A driver that needs credentials must not silently fall back to a half-working
 * state in production — that is how a "mock payment" reaches a real customer.
 * These rules turn a misconfiguration into a boot failure instead.
 */
function assertDriverCredentials(env: Env): string[] {
  const problems: string[] = [];

  const require = (condition: boolean, message: string) => {
    if (!condition) problems.push(message);
  };

  if (env.EMAIL_DRIVER === "smtp") {
    require(Boolean(env.SMTP_HOST), "EMAIL_DRIVER=smtp requires SMTP_HOST");
    require(Boolean(env.SMTP_USER), "EMAIL_DRIVER=smtp requires SMTP_USER");
    require(Boolean(env.SMTP_PASSWORD), "EMAIL_DRIVER=smtp requires SMTP_PASSWORD");
  }

  if (env.SMS_DRIVER === "twilio") {
    require(Boolean(env.TWILIO_ACCOUNT_SID), "SMS_DRIVER=twilio requires TWILIO_ACCOUNT_SID");
    require(Boolean(env.TWILIO_AUTH_TOKEN), "SMS_DRIVER=twilio requires TWILIO_AUTH_TOKEN");
    require(Boolean(env.TWILIO_FROM_NUMBER), "SMS_DRIVER=twilio requires TWILIO_FROM_NUMBER");
  }

  switch (env.PAYMENT_DRIVER) {
    case "stripe":
      require(Boolean(env.STRIPE_SECRET_KEY), "PAYMENT_DRIVER=stripe requires STRIPE_SECRET_KEY");
      require(
        Boolean(env.STRIPE_WEBHOOK_SECRET),
        "PAYMENT_DRIVER=stripe requires STRIPE_WEBHOOK_SECRET",
      );
      break;
    case "jazzcash":
      require(Boolean(env.JAZZCASH_MERCHANT_ID), "PAYMENT_DRIVER=jazzcash requires JAZZCASH_MERCHANT_ID");
      require(Boolean(env.JAZZCASH_PASSWORD), "PAYMENT_DRIVER=jazzcash requires JAZZCASH_PASSWORD");
      require(
        Boolean(env.JAZZCASH_INTEGRITY_SALT),
        "PAYMENT_DRIVER=jazzcash requires JAZZCASH_INTEGRITY_SALT",
      );
      break;
    case "easypaisa":
      require(Boolean(env.EASYPAISA_STORE_ID), "PAYMENT_DRIVER=easypaisa requires EASYPAISA_STORE_ID");
      require(Boolean(env.EASYPAISA_HASH_KEY), "PAYMENT_DRIVER=easypaisa requires EASYPAISA_HASH_KEY");
      break;
    case "paypal":
      require(Boolean(env.PAYPAL_CLIENT_ID), "PAYMENT_DRIVER=paypal requires PAYPAL_CLIENT_ID");
      require(Boolean(env.PAYPAL_CLIENT_SECRET), "PAYMENT_DRIVER=paypal requires PAYPAL_CLIENT_SECRET");
      break;
    case "mock":
      if (env.NODE_ENV === "production") {
        problems.push("PAYMENT_DRIVER=mock is not allowed when NODE_ENV=production");
      }
      break;
  }

  switch (env.VIDEO_DRIVER) {
    case "daily":
      require(Boolean(env.DAILY_API_KEY), "VIDEO_DRIVER=daily requires DAILY_API_KEY");
      break;
    case "zoom":
      require(Boolean(env.ZOOM_ACCOUNT_ID), "VIDEO_DRIVER=zoom requires ZOOM_ACCOUNT_ID");
      require(Boolean(env.ZOOM_CLIENT_ID), "VIDEO_DRIVER=zoom requires ZOOM_CLIENT_ID");
      require(Boolean(env.ZOOM_CLIENT_SECRET), "VIDEO_DRIVER=zoom requires ZOOM_CLIENT_SECRET");
      break;
    case "meet":
      require(Boolean(env.GOOGLE_MEET_CLIENT_ID), "VIDEO_DRIVER=meet requires GOOGLE_MEET_CLIENT_ID");
      require(
        Boolean(env.GOOGLE_MEET_CLIENT_SECRET),
        "VIDEO_DRIVER=meet requires GOOGLE_MEET_CLIENT_SECRET",
      );
      break;
    case "mock":
      break;
  }

  if (env.STORAGE_DRIVER === "s3") {
    require(Boolean(env.S3_BUCKET), "STORAGE_DRIVER=s3 requires S3_BUCKET");
    require(Boolean(env.S3_REGION), "STORAGE_DRIVER=s3 requires S3_REGION");
    require(Boolean(env.S3_ACCESS_KEY_ID), "STORAGE_DRIVER=s3 requires S3_ACCESS_KEY_ID");
    require(Boolean(env.S3_SECRET_ACCESS_KEY), "STORAGE_DRIVER=s3 requires S3_SECRET_ACCESS_KEY");
  }

  return problems;
}

/**
 * `next build` runs with NODE_ENV=production even on a developer's laptop, and
 * it evaluates module top-level code while collecting page data. Enforcing
 * production adapter rules there would make it impossible to build the app
 * without live payment credentials. The checks belong to *serving*, not
 * compiling, so they are skipped for the build phase only.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (!isBuildPhase()) {
    const problems = assertDriverCredentials(parsed.data);
    if (problems.length > 0) {
      throw new Error(
        `Invalid adapter configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
      );
    }
  }

  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export const env: Env = new Proxy({} as Env, {
  get: (_target, key: string) => getEnv()[key as keyof Env],
});
