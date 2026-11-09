import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  server: {
    fs: {
      allow: ["."],
    },
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
    testTimeout: 120_000,
    include: ["bench/**/*.browser.bench.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    benchmark: {
      include: ["bench/**/*.browser.bench.ts"],
    },
  },
});
