import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Pure logic runs in node, which is markedly faster. Component tests opt
    // into jsdom with a `// @vitest-environment jsdom` docblock — Vitest 4
    // removed `environmentMatchGlobs`.
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/generated/**",
        "src/**/*.d.ts",
        "src/app/**/layout.tsx",
        "src/components/ui/**",
      ],
      thresholds: {
        // Enforced on the logic that carries real risk; UI is covered by
        // component tests without a hard gate.
        "src/features/booking/services/**": { statements: 80, branches: 70, functions: 80, lines: 80 },
        "src/lib/utils/**": { statements: 85, branches: 75, functions: 85, lines: 85 },
      },
    },
  },
});
