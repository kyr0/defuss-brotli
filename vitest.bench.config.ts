import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    include: ["bench/**/*.bench.ts"],
    exclude: ["bench/**/*.browser.bench.ts", "**/node_modules/**", "**/dist/**"],
    benchmark: {
      include: ["bench/**/*.bench.ts"],
      exclude: ["bench/**/*.browser.bench.ts"],
    },
  },
});
