import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Both entry points stream through fixed chunks, so linear memory must not grow with the payload: WASM memory never
// shrinks, and the whole-buffer design kept 283 MiB after one 100 MiB decode for the life of the instance.
// The package does not expose its memory; this pass-through wrapper records each new instance's memory.
const memories: WebAssembly.Memory[] = [];
const instantiate = WebAssembly.instantiate;
const MiB = 2 ** 20;

beforeAll(() => {
  // A module argument resolves to an Instance, bytes to { module, instance }.
  const record = async (...args: unknown[]) => {
    const result = (await (instantiate as (...a: unknown[]) => Promise<unknown>).apply(WebAssembly, args)) as
      | WebAssembly.Instance
      | WebAssembly.WebAssemblyInstantiatedSource;
    const instance = "instance" in result ? result.instance : result;
    memories.push(instance.exports.memory as WebAssembly.Memory);
    return result;
  };
  WebAssembly.instantiate = record as typeof instantiate;
});

afterAll(() => {
  WebAssembly.instantiate = instantiate;
});

/** Deterministic incompressible bytes (xorshift): compressed output as large as the input. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const words = new Uint32Array(out.buffer);
  let x = 0x9e3779b9;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x >>> 0;
  }
  return out;
}

async function freshMemory<T>(load: () => Promise<T & { init(): Promise<void> }>): Promise<[T, WebAssembly.Memory]> {
  vi.resetModules();
  const module = await load();
  await module.init();
  return [module, memories.at(-1)!];
}

describe("WASM memory does not grow with the payload", () => {
  // Chunks grow with the input up to 1 MiB, so both payloads are incompressible and larger than one chunk.
  test("decompressor: a 64 MiB output needs no more memory than a 4 MiB one", async () => {
    const [decompressor, memory] = await freshMemory(() => import("./decompressor"));
    const data = noise(64 * MiB);
    const pack = (bytes: Uint8Array) =>
      new Uint8Array(brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } }));
    expect(decompressor.decompress(pack(data.subarray(0, 4 * MiB))).length).toBe(4 * MiB);
    const small = memory.buffer.byteLength;
    const plain = decompressor.decompress(pack(data), { maxOutputSize: 128 * MiB });
    expect(memory.buffer.byteLength).toBe(small);
    expect(small).toBeLessThan(16 * MiB);
    // Buffer.equals: a deep toEqual over this many bytes exhausts the V8 heap.
    expect(Buffer.from(plain.buffer, plain.byteOffset, plain.length).equals(data)).toBe(true);
  });

  test("compressor: 32 MiB of incompressible input needs no more memory than 8 MiB", async () => {
    const [compressor, memory] = await freshMemory(() => import("./compressor"));
    const data = noise(32 * MiB);
    const first = compressor.compress(data.subarray(0, 8 * MiB), { quality: 1 });
    const small = memory.buffer.byteLength;
    const packed = compressor.compress(data, { quality: 1 });
    expect(memory.buffer.byteLength).toBe(small);
    expect(brotliDecompressSync(first).equals(data.subarray(0, 8 * MiB))).toBe(true);
    expect(brotliDecompressSync(packed).equals(data)).toBe(true);
  });
});
