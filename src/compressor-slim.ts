// Entry point `defuss-brotli/compressor/slim`: the same API as `defuss-brotli/compressor`, without the inlined
// binary. `init()` loads `compressor.wasm`, which ships next to this file (`defuss-brotli/compressor.wasm`).
import { initFrom } from "./compressor-core.js";
import type { WasmSource } from "./wasm.js";

export {
  DEFAULT_LGWIN,
  DEFAULT_QUALITY,
  MIN_PART_SIZE,
  PARALLEL_PARTS,
  assertReady,
  compress,
  compressParallel,
  compressText,
  isReady,
  normalizeOptions,
  type BrotliCompressOptions,
  type BrotliParallelOptions,
} from "./compressor-core.js";
export type { WasmSource } from "./wasm.js";

/**
 * Load the Brotli compressor WASM module from a separate `.wasm` file. Must be called (and awaited) once before
 * any `compress` / `compressText` call.
 *
 * Without `source`, it loads `compressor.wasm` from next to this module (`new URL("./compressor.wasm",
 * import.meta.url)`): browsers fetch it, Node.js 20.16+ / 22.3+ and Bun read it from disk (VERIFIED: `make e2e`,
 * Chromium fetching it next to a Bun bundle and Node.js 26 reading it from node_modules). A bundler that does not
 * carry that file along needs `source`: a URL where you serve `defuss-brotli/compressor.wasm`, `fetch(...)`,
 * the bytes, or a compiled `WebAssembly.Module`.
 *
 * Idempotent: later calls return the first call's Promise and ignore their `source`; after a failed load, the next
 * call tries again.
 */
export function init(source?: WasmSource): Promise<void> {
  return initFrom(() => source ?? new URL("./compressor.wasm", import.meta.url));
}
