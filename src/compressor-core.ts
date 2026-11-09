// The API shared by `defuss-brotli/compressor` (WASM inlined) and `defuss-brotli/compressor/slim` (separate .wasm file).
// Each entry point only decides where the binary comes from. VERIFIED: both builds produce identical output
// (`make e2e` round-trips through both and decodes slim output with the inline build).
import * as glue from "../wasm/pkg/compressor/defuss_brotli_compressor_bg.js";
import WORKER_SOURCE from "../wasm/pkg/compressor/worker_source.js";
import { encodeWith } from "./compressor-encode.js";
import { concat, instantiateWasm, type WasmSource } from "./wasm.js";
import { runParts, type PartTask } from "./workers.js";

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
   * @default 11
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

/**
 * Default compression quality: the smallest output. VERIFIED: the same default as Node.js zlib
 * (`BROTLI_DEFAULT_QUALITY` = 11) and the `brotli` CLI. Pass a lower quality when compression time matters more.
 */
export const DEFAULT_QUALITY = 11;

/** Default sliding window exponent, as in Node.js zlib (`BROTLI_DEFAULT_WINDOW` = 22). */
export const DEFAULT_LGWIN = 22;

/**
 * Options for {@link compressParallel}.
 *
 * @example
 * ```ts
 * await compressParallel(data);                 // quality 11, one worker per CPU core
 * await compressParallel(data, { threads: 2 }); // same bytes, two workers
 * ```
 */
export interface BrotliParallelOptions extends BrotliCompressOptions {
  /**
   * How many workers compress parts at once; 1 compresses the parts one after another on the calling thread. More
   * workers than parts add nothing. The output does not depend on it.
   *
   * @default the number of logical CPUs
   */
  threads?: number;
}

/**
 * A parallel compression splits inputs up to {@link PARALLEL_PARTS} × {@link PART_WINDOWS} windows into this many
 * parts of at least {@link MIN_PART_SIZE} bytes. A constant rather than the number of CPUs, so the output is the same
 * on every machine. VERIFIED (native, brotli 8.0.2, quality 11): with 8 threads, 8 parts beat 4 and 16 on a 256 KiB
 * SVG, the 5.1 MB SVG and a 20 MB mix.
 */
export const PARALLEL_PARTS = 8;

/**
 * Longer inputs split into parts of this many windows, so they keep more cores busy. Every part after the first
 * re-reads up to one window of input as its dictionary, which costs about as much as compressing a quarter of a
 * window, so parts must be several windows long before an extra part pays off. VERIFIED (WASM, Node.js 26, Apple M5
 * Max with 18 cores, quality 11, window 22, 128 MiB of log lines, median of 3): 16 parts of 2 windows took 18.4 s on
 * 18 workers against 25.7 s for 8 parts, and 27.0 s against 26.2 s on 8 workers; 32 parts of 1 window took 19.5 s and
 * 30.0 s. With parts of 2 windows, inputs up to 64 MiB keep their 8 parts.
 */
const PART_WINDOWS = 2;

/** Smallest part. VERIFIED: 32 KiB parts cost a 256 KiB SVG 0.007 % in size, 16 KiB parts of a 29 KB page 1.6 %. */
export const MIN_PART_SIZE = 32 * 1024;

let initPromise: Promise<void> | null = null;
let ready = false;
let memory: WebAssembly.Memory | null = null;
let compiled: WebAssembly.Module | null = null;

/**
 * The lowest quality that compresses in parts. VERIFIED: (brotli 8.0.2 to 9.1.1, 2026-11-09) with a custom
 * dictionary, the matcher of qualities 2 to 9 can emit a copy shorter than 2 bytes and panics, which traps in WASM
 * (parts of huge.svg at quality 5 and 6, window 18 to 24, and at quality 2, window 16). Qualities 10 and 11 search
 * with Zopfli and compressed every part of the same inputs at windows 10 to 24. They are also the ones that take
 * seconds, so below them one thread is fast enough.
 */
const MIN_PARALLEL_QUALITY = 10;

/**
 * The byte ranges of a parallel compression: one range below {@link MIN_PARALLEL_QUALITY} or when the input fits in
 * one part; otherwise {@link PARALLEL_PARTS} parts, or parts of {@link PART_WINDOWS} windows when those are shorter,
 * never shorter than {@link MIN_PART_SIZE} bytes.
 */
export function partRanges(length: number, quality: number, lgwin: number): Array<[number, number]> {
  const size = Math.max(Math.min(Math.ceil(length / PARALLEL_PARTS), PART_WINDOWS * 2 ** lgwin), MIN_PART_SIZE);
  if (quality < MIN_PARALLEL_QUALITY || length <= size) return [[0, length]];
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < length; start += size) ranges.push([start, Math.min(start + size, length)]);
  return ranges;
}

/** Joins part streams, in input order, through a WASM `Joiner` (fixed buffers, as in `encodeWith`). */
function joinParts(wasm: WebAssembly.Memory, parts: Uint8Array[]): Uint8Array {
  const joiner = new glue.Joiner();
  try {
    const inputPtr = joiner.input_ptr();
    const outputPtr = joiner.output_ptr();
    const capacity = joiner.input_capacity();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const take = (written: number) => {
      if (written > 0) chunks.push(new Uint8Array(wasm.buffer, outputPtr, written).slice());
      size += written;
    };
    for (const part of parts) {
      joiner.next_part();
      for (let offset = 0; offset < part.length; offset += capacity) {
        const chunk = part.subarray(offset, offset + capacity);
        new Uint8Array(wasm.buffer, inputPtr, chunk.length).set(chunk);
        let len = chunk.length;
        do {
          take(joiner.join(len));
          len = 0;
        } while (!joiner.needs_input());
      }
    }
    while (!joiner.finished()) take(joiner.finish());
    return concat(chunks, size);
  } finally {
    joiner.free();
  }
}

function defaultThreads(): number {
  const runtime = globalThis as {
    navigator?: { hardwareConcurrency?: number };
    process?: { getBuiltinModule?(id: string): { availableParallelism?(): number } | undefined };
  };
  const cpus = runtime.navigator?.hardwareConcurrency ?? runtime.process?.getBuiltinModule?.("node:os")?.availableParallelism?.();
  return cpus ?? 1;
}

/**
 * Throws if `init()` has not been called yet.
 * Used internally before every compress call.
 */
export function assertReady(): void {
  if (!ready || !memory || !compiled) {
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
        (wasm) => {
          memory = wasm.memory;
          compiled = wasm.module;
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
  return encodeWith(memory!, new glue.Encoder(input.length, quality, lgwin), input);
}

/**
 * Compress raw bytes with Brotli on several workers.
 *
 * The input is split into {@link PARALLEL_PARTS} parts, or into parts of two windows (8 MiB at the default window)
 * when it is longer than 64 MiB, each at least {@link MIN_PART_SIZE} bytes. Each worker
 * runs its own instance of the compressor and compresses one part with the window before it as dictionary, so
 * matches still reach across parts; the calling thread joins the parts into one standard Brotli stream. The output
 * depends only on the input and the options other than `threads`, and differs slightly from {@link compress}'s
 * when there is more than one part. Below quality 10, or when the input fits in one part, it equals `compress`.
 * Workers start from a Blob URL (browsers, Bun; a Content Security Policy must allow `worker-src blob:`) or, in
 * Node.js, with `worker_threads`, and are terminated before the Promise settles. Where no such worker starts, the
 * parts run one after another on the calling thread, with the same output.
 *
 * @param input   Raw bytes to compress. Not modified; do not change it until the Promise settles, because parts are
 *                copied when a worker takes them.
 * @param options Compression tuning and the number of workers — see {@link BrotliParallelOptions}.
 * @returns A Promise of a new `Uint8Array` with the Brotli-compressed output.
 *
 * @throws If `init()` was not called first, or if options are out of range.
 *
 * @example
 * ```ts
 * await init();
 * const compressed = await compressParallel(bigFileBytes);
 * ```
 */
export async function compressParallel(input: Uint8Array, options: BrotliParallelOptions = {}): Promise<Uint8Array> {
  assertReady();
  const { quality, lgwin } = normalizeOptions(options);
  const threads = options.threads ?? defaultThreads();
  if (!Number.isInteger(threads) || threads < 1) throw new Error("threads must be a positive integer");
  const ranges = partRanges(input.length, quality, lgwin);
  if (ranges.length === 1) return compress(input, { quality, lgwin });

  const window = 2 ** lgwin - 16;
  // Copies with their own buffers, which are transferred to the workers: `Buffer#slice` would share (and detach)
  // the caller's memory. Made when a worker takes the part, so memory grows with the workers, not the parts.
  const copy = (start: number, end: number) => new Uint8Array(input.subarray(start, end));
  const task = (id: number): PartTask => {
    const [start, end] = ranges[id]!;
    return { total: input.length, quality, lgwin, part: copy(start, end), dictionary: copy(Math.max(0, start - window), start) };
  };
  const parts =
    (threads > 1 ? await runParts(WORKER_SOURCE, compiled!, ranges.length, task, Math.min(threads, ranges.length)) : null) ??
    ranges.map(([start, end]) =>
      encodeWith(
        memory!,
        glue.Encoder.part(end - start, input.length, quality, lgwin, input.subarray(Math.max(0, start - window), start)),
        input.subarray(start, end),
      ),
    );
  return joinParts(memory!, parts);
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
