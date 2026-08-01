import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env implicitly, so load it before the config is
// evaluated — `datasource.url` resolves from process.env at this point.
loadEnv({ path: ".env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --env-file-if-exists=.env prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
