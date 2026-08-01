import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

/**
 * ESLint 9 flat config.
 *
 * `next lint` is deprecated in Next 15 and removed in 16, so ESLint is invoked
 * directly. `eslint-config-next` still ships in the legacy shareable format,
 * hence FlatCompat.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**", // Prisma output — not ours to lint
      "coverage/**",
      "storage/**",
      "next-env.d.ts",
    ],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      // Unused args are legitimate when they document a signature; the
      // underscore prefix is the opt-out.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // The codebase bans `any` outright; surface it as an error, not a warning.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    // Seeds and one-shot scripts legitimately log to stdout.
    files: ["prisma/**/*.ts", "scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },

  {
    // CommonJS config files: `require` is the correct module syntax there, not
    // a lapse. Tailwind resolves plugins this way.
    files: ["*.config.js", "*.config.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default config;
