import { describe, expect, test, vi } from "vitest";

// Fresh, uninitialized module instances of every entry point (init() runs once per instance).
const entries = {
  "defuss-brotli/compressor": () => import("./compressor"),
  "defuss-brotli/compressor/slim": () => import("./compressor-slim"),
  "defuss-brotli/decompressor": () => import("./decompressor"),
  "defuss-brotli/decompressor/slim": () => import("./decompressor-slim"),
};

describe("before init()", () => {
  test.each(Object.keys(entries))("%s throws a clear Error until init() resolves", async (name) => {
    vi.resetModules();
    const entry = await entries[name as keyof typeof entries]();
    expect(entry.isReady()).toBe(false);
    const call = "compress" in entry ? () => entry.compress(new Uint8Array(1)) : () => entry.decompress(new Uint8Array(1));
    expect(call).toThrowError(/is not initialized\. Call await init\(\) first\./);
  });
});

describe("slim init() without a source", () => {
  // src/ holds no .wasm; in dist/ the same lookup finds the shipped file (covered by make e2e).
  test.each([
    ["decompressor", () => import("./decompressor-slim")],
    ["compressor", () => import("./compressor-slim")],
  ])("looks for %s.wasm next to its module", async (name, load) => {
    vi.resetModules();
    const slim = await load();
    await expect(slim.init()).rejects.toThrow(new RegExp(`src/${name}\\.wasm`));
  });
});

describe("init() is idempotent", () => {
  test("concurrent and repeated calls share one Promise and one instance", async () => {
    vi.resetModules();
    const compressor = await import("./compressor");
    const first = compressor.init();
    expect(compressor.init()).toBe(first);
    await first;
    expect(compressor.init()).toBe(first);
  });
});

describe("slim init() with a file: URL", () => {
  test("asks for bytes in runtimes without process.getBuiltinModule", async () => {
    vi.resetModules();
    const slim = await import("./decompressor-slim");
    const original = process.getBuiltinModule;
    try {
      (process as { getBuiltinModule?: unknown }).getBuiltinModule = undefined;
      await expect(slim.init(new URL("file:///defuss/decompressor.wasm"))).rejects.toThrow(
        "cannot read file:///defuss/decompressor.wasm in this runtime; pass the .wasm bytes or a Response to init() instead",
      );
    } finally {
      process.getBuiltinModule = original;
    }
  });
});
