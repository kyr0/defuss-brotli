// Entry point `defuss-brotli/decompressor/slim`: the same API as `defuss-brotli/decompressor`, without the inlined
// binary. `init()` loads `decompressor.wasm`, which ships next to this file (`defuss-brotli/decompressor.wasm`).
import { initFrom } from "./decompressor-core.js";
import type { WasmSource } from "./wasm.js";

export {
  DEFAULT_MAX_OUTPUT_SIZE,
  assertReady,
  decompress,
  decompressText,
  isReady,
  normalizeOptions,
  wasmDecompressBytes,
  type BrotliDecompressOptions,
} from "./decompressor-core.js";
export type { WasmSource } from "./wasm.js";

/**
 * Load the Brotli decompressor WASM module from a separate `.wasm` file. Must be called (and awaited) once before
 * any `decompress` / `decompressText` call.
 *
 * Without `source`, it loads `decompressor.wasm` from next to this module (`new URL("./decompressor.wasm",
 * import.meta.url)`): browsers fetch it, Node.js 20.16+ / 22.3+ and Bun read it from disk (VERIFIED: `make e2e`,
 * Chromium fetching it next to a Bun bundle and Node.js 26 reading it from node_modules). A bundler that does not
 * carry that file along needs `source`: a URL where you serve `defuss-brotli/decompressor.wasm`, `fetch(...)`,
 * the bytes, or a compiled `WebAssembly.Module`.
 *
 * Idempotent: later calls return the first call's Promise and ignore their `source`; after a failed load, the next
 * call tries again.
 */
export function init(source?: WasmSource): Promise<void> {
  return initFrom(() => source ?? new URL("./decompressor.wasm", import.meta.url));
}
