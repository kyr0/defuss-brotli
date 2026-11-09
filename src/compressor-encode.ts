// The chunk loop that drives a WASM `Encoder`, shared by the calling thread (src/compressor-core.ts) and the
// workers of a parallel compression (src/compressor-worker.ts), which each own a separate WASM instance. One loop
// for both keeps their output equal. VERIFIED: compressParallel returns the same bytes with 1 and 4 threads.
import { concat } from "./wasm.js";

/** The `Encoder` methods the loop uses, from whichever instance created the encoder. */
export interface ChunkEncoder {
  input_ptr(): number;
  output_ptr(): number;
  input_capacity(): number;
  needs_input(): boolean;
  encode(len: number, last: boolean): number;
  finished(): boolean;
  free(): void;
}

/**
 * Encodes `input` through `encoder` and frees it: one window (`2 ** lgwin` bytes) of input at a time is copied into
 * WASM memory and each compressed chunk (at most 1 MiB) straight out of it, so linear memory holds the encoder
 * state and two chunks rather than the whole input and output. The chunks are joined once at the end.
 */
export function encodeWith(wasm: WebAssembly.Memory, encoder: ChunkEncoder, input: Uint8Array): Uint8Array {
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
