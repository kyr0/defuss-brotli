// The API shared by `defuss-brotli/decompressor` (WASM inlined) and `defuss-brotli/decompressor/slim` (separate .wasm file).
// Each entry point only decides where the binary comes from. VERIFIED: both builds produce identical output
// (`make e2e` round-trips through both and decodes slim output with the inline build).
import * as glue from "../wasm/pkg/decompressor/defuss_brotli_decompressor_bg.js";
import { concat, instantiateWasm, type WasmSource } from "./wasm.js";

/**
 * Options for Brotli decompression.
 */
export interface BrotliDecompressOptions {
  /**
   * Hard limit for decompressed output size in bytes.
   *
   * Guards against **decompression bombs** — a tiny compressed payload that
   * expands into gigabytes. If the decoded output would exceed this limit
   * the WASM module throws immediately.
   *
   * @default 67_108_864 (64 MiB)
   */
  maxOutputSize?: number;
}

/**
 * Default decompressed-output cap: 64 MiB.
 * Raise explicitly if you legitimately expect larger payloads.
 */
export const DEFAULT_MAX_OUTPUT_SIZE = 64 * 1024 * 1024;

const WASM32_MAX_USIZE = 2 ** 32 - 1;

let initPromise: Promise<void> | null = null;
let ready = false;

/**
 * Decodes `input` through a WASM `Decoder` in chunks of at most 1 MiB: each compressed chunk is copied into WASM
 * memory and each decoded chunk straight out of it, so linear memory stays at the decoder state plus two chunks.
 * The chunks are joined once at the end. VERIFIED: in Node.js 26 and Bun 1.4, joining 100 MiB from 1 MiB chunks
 * (7-9 ms) beats a resizable `ArrayBuffer` with `transferToFixedLength()` (14-15 ms), which copies as well.
 */
function decodeChunks(wasm: WebAssembly.Memory, input: Uint8Array, maxOutputSize: number): Uint8Array {
  const decoder = new glue.Decoder(input.length, maxOutputSize);
  try {
    const inputPtr = decoder.input_ptr();
    const outputPtr = decoder.output_ptr();
    const capacity = decoder.input_capacity();
    const parts: Uint8Array[] = [];
    let offset = 0;
    let size = 0;
    do {
      let len = 0;
      if (decoder.needs_input()) {
        len = Math.min(capacity, input.length - offset);
        new Uint8Array(wasm.buffer, inputPtr, len).set(input.subarray(offset, offset + len));
        offset += len;
      }
      const written = decoder.decode(len, offset === input.length);
      // Views are taken after each call: growing WASM memory detaches the previous `memory.buffer`.
      if (written > 0) parts.push(new Uint8Array(wasm.buffer, outputPtr, written).slice());
      size += written;
    } while (!decoder.finished());
    return concat(parts, size);
  } finally {
    decoder.free();
  }
}

/** The raw decoder after `init()`, without option defaults or validation; `null` before. */
export let wasmDecompressBytes: ((input: Uint8Array, maxOutputSize: number) => Uint8Array) | null = null;

/**
 * Throws if `init()` has not been called yet.
 * Used internally before every decompress call.
 */
export function assertReady(): void {
  if (!ready || !wasmDecompressBytes) {
    throw new Error("defuss-brotli/decompressor is not initialized. Call await init() first.");
  }
}

/**
 * Validates and applies defaults for decompression options.
 *
 * @throws If `maxOutputSize` is not a positive integer.
 */
export function normalizeOptions(
  options: BrotliDecompressOptions = {},
): Required<BrotliDecompressOptions> {
  const maxOutputSize = options.maxOutputSize ?? DEFAULT_MAX_OUTPUT_SIZE;
  if (!Number.isInteger(maxOutputSize) || maxOutputSize <= 0) {
    throw new Error("maxOutputSize must be a positive integer");
  }
  return { maxOutputSize };
}

/**
 * Instantiates the WASM module from `source()` on the first call; later calls return the same Promise
 * until it settles. A rejected load is forgotten, so the next call tries again.
 *
 * @internal Called by the entry points' `init()`; not part of the public API.
 */
export function initFrom(source: () => WasmSource): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.resolve()
      .then(() => instantiateWasm(source(), "./defuss_brotli_decompressor_bg.js", glue))
      .then(
        ({ memory }) => {
          wasmDecompressBytes = (input, maxOutputSize) => decodeChunks(memory, input, maxOutputSize);
          ready = true;
        },
        (error: unknown) => {
          initPromise = null; // a failed load (e.g. a slim .wasm fetch) may be retried
          throw error;
        },
      );
  }
  return initPromise;
}

/**
 * Non-throwing readiness check.
 *
 * @returns `true` after `init()` has resolved, `false` otherwise.
 */
export function isReady(): boolean {
  return ready;
}

/**
 * Decompress a Brotli-compressed `Uint8Array` back to raw bytes.
 *
 * Use this when the decompressed content is **binary** (images, protobuf,
 * WASM, etc.) or when you want to handle text decoding yourself.
 *
 * For UTF-8 text payloads, see {@link decompressText}.
 *
 * @param input   Brotli-compressed bytes.
 * @param options Decompression limits — see {@link BrotliDecompressOptions}.
 * @returns A new `Uint8Array` containing the decompressed output.
 *
 * @throws If `init()` was not called first.
 * @throws If the output would exceed `maxOutputSize`.
 * @throws If the input is not valid Brotli data.
 *
 * @example
 * ```ts
 * await init();
 * const raw = decompress(compressedBytes);
 * ```
 */
export function decompress(
  input: Uint8Array,
  options: BrotliDecompressOptions = {},
): Uint8Array {
  assertReady();
  const { maxOutputSize } = normalizeOptions(options);
  // VERIFIED: wasm32 `usize` is 32 bits and wasm-bindgen wraps larger numbers modulo 2^32 (2^32 + 8 became 8);
  // no wasm32 output can exceed 2^32 - 1, so clamping keeps the caller's intent.
  return wasmDecompressBytes!(input, Math.min(maxOutputSize, WASM32_MAX_USIZE));
}

/**
 * Decompress a Brotli-compressed `Uint8Array` and decode the result as a
 * UTF-8 string.
 *
 * Internally calls {@link decompress} and then applies `TextDecoder` to
 * convert the bytes back to a JS string. This is the counterpart to
 * `compressText()` from the compressor module.
 *
 * **Note:** If the decompressed bytes are not valid UTF-8, `TextDecoder`
 * will insert U+FFFD replacement characters rather than throwing.
 *
 * @param input   Brotli-compressed bytes that decode to UTF-8 text.
 * @param options Decompression limits — see {@link BrotliDecompressOptions}.
 * @returns The decompressed UTF-8 string.
 *
 * @example
 * ```ts
 * await init();
 * const json = decompressText(compressedJsonBytes);
 * const data = JSON.parse(json);
 * ```
 */
export function decompressText(
  input: Uint8Array,
  options: BrotliDecompressOptions = {},
): string {
  return new TextDecoder().decode(decompress(input, options));
}
