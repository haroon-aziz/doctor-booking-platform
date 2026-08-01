import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { getEmailAdapter } from "@/adapters/email";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import {
  passwordResetEmail,
  verificationEmail,
  welcomeEmail,
} from "@/lib/auth/email-templates";

/**
 * Better Auth server instance.
 *
 * Security decisions worth stating explicitly:
 *   * `role` and `status` are `input: false`. Without that, a crafted signup
 *     body could set `role: "ADMIN"` — mass assignment is the single most
 *     dangerous default in any auth layer.
 *   * Sessions are cookie-cached for one minute to avoid a database read on
 *     every request, but the cache is short enough that a suspension takes
 *     effect almost immediately.
 *   * Verification and reset mail goes through the email *adapter*, so it is
 *     captured to `storage/mailbox/` offline and sent by SMTP in production
 *     without any code change.
 */

export const auth = betterAuth({
  appName: env.APP_NAME,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: false,
    autoSignIn: true,

    sendResetPassword: async ({ user, url }) => {
      const template = passwordResetEmail({ name: user.name, url });
      const result = await getEmailAdapter().send({ to: user.email, ...template });
      if (!result.ok) {
        logger.error({ email: user.email, error: result.errorMessage }, "Password reset email failed");
      }
    },

    onPasswordReset: async ({ user }) => {
      logger.info({ userId: user.id }, "Password reset completed");
      // Every other session is invalidated so a stolen session cannot outlive
      // the password that protected it.
      await prisma.session.deleteMany({ where: { userId: user.id } });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,

    sendVerificationEmail: async ({ user, url }) => {
      const template = verificationEmail({ name: user.name, url });
      const result = await getEmailAdapter().send({ to: user.email, ...template });
      if (!result.ok) {
        logger.error({ email: user.email, error: result.errorMessage }, "Verification email failed");
      }
    },

    afterEmailVerification: async (user) => {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: "ACTIVE" },
      });
      const template = welcomeEmail({ name: user.name, appUrl: env.APP_URL });
      await getEmailAdapter().send({ to: user.email, ...template });
    },
  },

  session: {
    expiresIn: env.SESSION_MAX_AGE_SECONDS,
    updateAge: env.SESSION_UPDATE_AGE_SECONDS,
    cookieCache: { enabled: true, maxAge: 60 },
    freshAge: 60 * 15,
  },

  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "PATIENT" },
      status: { type: "string", input: false, defaultValue: "PENDING_VERIFICATION" },
      phone: { type: "string", input: true, required: false },
      phoneVerified: { type: "boolean", input: false, defaultValue: false },
      timezone: { type: "string", input: true, required: false, defaultValue: "Asia/Karachi" },
      locale: { type: "string", input: true, required: false, defaultValue: "en" },
    },
    changeEmail: { enabled: true },
    deleteUser: { enabled: false },
  },

  account: {
    accountLinking: { enabled: true, trustedProviders: ["credential"] },
  },

  advanced: {
    cookiePrefix: "medibook",
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  },

  // Better Auth's own limiter guards the auth endpoints; application routes use
  // the Redis limiter in `src/lib/rate-limit`.
  rateLimit: {
    enabled: true,
    window: env.RATE_LIMIT_AUTH_WINDOW_SECONDS,
    max: env.RATE_LIMIT_AUTH_MAX,
  },

  databaseHooks: {
    user: {
      create: {
        // A patient profile is what appointments, records and reviews hang off,
        // so it is created in the same breath as the account rather than lazily
        // on first booking — otherwise every read path needs a null check.
        after: async (user) => {
          const role = (user as { role?: string }).role ?? "PATIENT";
          if (role !== "PATIENT") return;

          await prisma.patient.upsert({
            where: { userId: user.id },
            create: { userId: user.id },
            update: {},
          });
          logger.info({ userId: user.id }, "Patient profile created for new account");
        },
      },
    },
  },

  trustedOrigins: [env.APP_URL],

  // Must remain last: it flushes Set-Cookie headers from server actions.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
export type AuthSession = Auth["$Infer"]["Session"];
