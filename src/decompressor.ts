// Entry point `defuss-brotli/decompressor`: the WASM binary is inlined as base64, so this one file is all a runtime
// or bundler needs. `defuss-brotli/decompressor/slim` loads the same binary from a separate .wasm file instead.
// VERIFIED: decoding the base64 costs under 1 ms at init() (Node 26, Bun 1.3; ARCH.md).
import wasmBase64 from "../wasm/pkg/decompressor/wasm_base64.js";
import { initFrom } from "./decompressor-core.js";
import { decodeBase64 } from "./wasm.js";

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

/**
 * Load the Brotli decompressor WASM module. Must be called (and awaited)
 * once before any `decompress` / `decompressText` call.
 *
 * Idempotent — calling `init()` multiple times returns the same Promise and
 * does not reload the WASM binary.
 *
 * Works identically in Node.js and browsers.
 */
export function init(): Promise<void> {
  return initFrom(() => decodeBase64(wasmBase64));
}
