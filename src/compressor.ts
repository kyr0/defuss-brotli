// Entry point `defuss-brotli/compressor`: the WASM binary is inlined as base64, so this one file is all a runtime
// or bundler needs. `defuss-brotli/compressor/slim` loads the same binary from a separate .wasm file instead.
// VERIFIED: decoding the base64 costs under 1 ms at init() (Node 26, Bun 1.3; ARCH.md).
import wasmBase64 from "../wasm/pkg/compressor/wasm_base64.js";
import { initFrom } from "./compressor-core.js";
import { decodeBase64 } from "./wasm.js";

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

/**
 * Load the Brotli compressor WASM module. Must be called (and awaited) once
 * before any `compress` / `compressText` call.
 *
 * Idempotent — calling `init()` multiple times returns the same Promise and
 * does not reload the WASM binary.
 *
 * Works identically in Node.js and browsers.
 */
export function init(): Promise<void> {
  return initFrom(() => decodeBase64(wasmBase64));
}
