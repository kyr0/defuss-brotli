// The API shared by `defuss-brotli/compressor` (WASM inlined) and `defuss-brotli/compressor/slim` (separate .wasm file).
// Each entry point only decides where the binary comes from. VERIFIED: both builds produce identical output
// (`make e2e` round-trips through both and decodes slim output with the inline build).
import * as glue from "../wasm/pkg/compressor/defuss_brotli_compressor_bg.js";
import { concat, instantiateWasm, type WasmSource } from "./wasm.js";

/**
 * Options for Brotli compression.
 *
 * @example
 * ```ts
 * compress(data, { quality: 11, lgwin: 22 }); // smallest output, slowest
 * compress(data, { quality: 1 });              // fastest, larger output
 * ```
 */
export interface BrotliCompressOptions {
  /**
   * Brotli compression quality level (0–11).
   *
   * - **0** — fastest compression, largest output
   * - **5–7** — good balance for web text (HTML/CSS/JS/JSON)
   * - **11** — smallest output, slowest compression
   *
   * @default 6
   */
  quality?: number;

  /**
   * Sliding window size exponent (10–24).
   *
   * Larger windows let the encoder find longer matches at the cost of more
   * memory. **22** is a strong default for typical web payloads.
   *
   * @default 22
   */
  lgwin?: number;
}

/** Default compression quality. Good balance of speed and ratio for web text. */
export const DEFAULT_QUALITY = 6;

/** Default sliding window exponent. Covers most web-text repetition patterns. */
export const DEFAULT_LGWIN = 22;

let initPromise: Promise<void> | null = null;
let ready = false;
let memory: WebAssembly.Memory | null = null;

/**
 * Encodes `input` through a WASM `Encoder`: one window (`2 ** lgwin` bytes) of input at a time is copied into WASM
 * memory and each compressed chunk (at most 1 MiB) straight out of it, so linear memory holds the encoder state
 * and two chunks rather than the whole input and output. The chunks are joined once at the end.
 */
function encodeChunks(wasm: WebAssembly.Memory, input: Uint8Array, quality: number, lgwin: number): Uint8Array {
  const encoder = new glue.Encoder(input.length, quality, lgwin);
  try {
    const inputPtr = encoder.input_ptr();
    const outputPtr = encoder.output_ptr();
    const capacity = encoder.input_capacity();
    const parts: Uint8Array[] = [];
    let offset = 0;
    let size = 0;
    do {
      let len = 0;
      if (encoder.needs_input()) {
        len = Math.min(capacity, input.length - offset);
        new Uint8Array(wasm.buffer, inputPtr, len).set(input.subarray(offset, offset + len));
        offset += len;
      }
      const written = encoder.encode(len, offset === input.length);
      // Views are taken after each call: growing WASM memory detaches the previous `memory.buffer`.
      if (written > 0) parts.push(new Uint8Array(wasm.buffer, outputPtr, written).slice());
      size += written;
    } while (!encoder.finished());
    return concat(parts, size);
  } finally {
    encoder.free();
  }
}

/**
 * Throws if `init()` has not been called yet.
 * Used internally before every compress call.
 */
export function assertReady(): void {
  if (!ready || !memory) {
    throw new Error("defuss-brotli/compressor is not initialized. Call await init() first.");
  }
}

/**
 * Validates and applies defaults for compression options.
 *
 * @throws If `quality` is not an integer in 0–11 or `lgwin` is not in 10–24.
 */
export function normalizeOptions(options: BrotliCompressOptions = {}): Required<BrotliCompressOptions> {
  const quality = options.quality ?? DEFAULT_QUALITY;
  const lgwin = options.lgwin ?? DEFAULT_LGWIN;

  if (!Number.isInteger(quality) || quality < 0 || quality > 11) {
    throw new Error("quality must be an integer between 0 and 11");
  }
  if (!Number.isInteger(lgwin) || lgwin < 10 || lgwin > 24) {
    throw new Error("lgwin must be an integer between 10 and 24");
  }

  return { quality, lgwin };
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
      .then(() => instantiateWasm(source(), "./defuss_brotli_compressor_bg.js", glue))
      .then(
        (wasmMemory) => {
          memory = wasmMemory;
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
 * Compress raw bytes with Brotli.
 *
 * Use this when you already have a `Uint8Array` (binary data, pre-encoded
 * text, HTTP response bodies, etc.). No encoding is performed — what you
 * pass in is exactly what gets compressed.
 *
 * For compressing JS strings directly, see {@link compressText}.
 *
 * @param input   Raw bytes to compress.
 * @param options Compression tuning — see {@link BrotliCompressOptions}.
 * @returns A new `Uint8Array` containing the Brotli-compressed output.
 *
 * @throws If `init()` was not called first.
 * @throws If options are out of range.
 *
 * @example
 * ```ts
 * await init();
 * const compressed = compress(myFileBytes, { quality: 11 });
 * ```
 */
export function compress(input: Uint8Array, options: BrotliCompressOptions = {}): Uint8Array {
  assertReady();
  const { quality, lgwin } = normalizeOptions(options);
  return encodeChunks(memory!, input, quality, lgwin);
}

/**
 * Compress a JS string with Brotli.
 *
 * Internally encodes the string to UTF-8 via `TextEncoder` and then
 * delegates to {@link compress}. This is the right choice when your input is
 * a plain string (JSON, HTML, Markdown, etc.) and you don't want to deal
 * with encoding yourself.
 *
 * To decompress back to a string, use `decompressText()` from the
 * decompressor module.
 *
 * @param text    The string to compress.
 * @param options Compression tuning — see {@link BrotliCompressOptions}.
 * @returns A new `Uint8Array` containing the Brotli-compressed output.
 *
 * @example
 * ```ts
 * await init();
 * const compressed = compressText('{"hello":"world"}', { quality: 6 });
 * ```
 */
export function compressText(text: string, options: BrotliCompressOptions = {}): Uint8Array {
  return compress(new TextEncoder().encode(text), options);
}
