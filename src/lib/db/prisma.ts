import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/lib/config/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 removed the Rust query engine, so a driver adapter supplies the
 * actual Postgres connection. The pool lives on `globalThis` in development
 * because Next's hot reload re-evaluates modules on every edit and would
 * otherwise exhaust Postgres connections within a few saves.
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ]
        : [{ emit: "stdout", level: "error" }],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
export { Prisma } from "@/generated/prisma/client";
