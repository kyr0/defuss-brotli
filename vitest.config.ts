import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.browser.test.ts", "**/node_modules/**", "**/dist/**"],
    clearMocks: true,
    globals: true,
    coverage: {
      provider: "v8",
      reporter: [["text", { skipFull: false }]],
      include: ["src/**/*"],
      exclude: ["src/**/*.test.ts", "src/**/*.browser.test.ts"],
    },
  },
});
