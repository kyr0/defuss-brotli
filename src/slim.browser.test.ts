import { describe, expect, test } from "vitest";
import { FIXTURE_TEXT } from "./fixtures";
import * as compressor from "./compressor-slim";
import * as decompressor from "./decompressor-slim";
import { instantiateWasm } from "./wasm";

describe("slim entry points (browser)", () => {
  test("fetch the .wasm files from the dev server and round-trip text", async () => {
    await Promise.all([
      compressor.init(new URL("../wasm/pkg/compressor/defuss_brotli_compressor_bg.wasm", import.meta.url)),
      decompressor.init(fetch(new URL("../wasm/pkg/decompressor/defuss_brotli_decompressor_bg.wasm", import.meta.url))),
    ]);
    expect(decompressor.decompressText(compressor.compressText(FIXTURE_TEXT))).toBe(FIXTURE_TEXT);
  });

  // A browser has no `process.getBuiltinModule`; the loader must say what to pass instead of failing obscurely.
  test("file: URLs fail with a clear Error where no file system is reachable", async () => {
    const glue = { __wbg_set_wasm() {} };
    await expect(instantiateWasm(new URL("file:///decompressor.wasm"), "./glue.js", glue)).rejects.toThrow(
      "pass the .wasm bytes or a Response",
    );
  });
});
