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
      // src/bin.ts only wires src/cli.ts to the process. VERIFIED: `make e2e-cli` runs it from the installed tarball
      // through bunx in Node.js and in Bun, which this in-process coverage cannot see.
      // src/compressor-worker.ts runs inside the workers, from the string the build embeds.
      exclude: ["src/**/*.test.ts", "src/**/*.browser.test.ts", "src/bin.ts", "src/compressor-worker.ts"],
    },
  },
});
