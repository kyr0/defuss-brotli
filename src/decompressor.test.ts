import { brotliCompressSync, constants } from "node:zlib";
import { beforeAll, describe, expect, test } from "vitest";

import { FIXTURE_BINARY, FIXTURE_TEXT, FIXTURE_TEXT_BROTLI } from "./fixtures";
import * as decompressor from "./decompressor";
import * as compressor from "./compressor";

beforeAll(async () => {
  await decompressor.init();
  await compressor.init();
});

describe("decompressor", () => {
  test("decompresses a Node.js Brotli fixture", () => {
    expect(decompressor.decompressText(FIXTURE_TEXT_BROTLI)).toBe(FIXTURE_TEXT);
  });

  test("decompresses Node.js binary Brotli output", () => {
    const compressed = brotliCompressSync(Buffer.from(FIXTURE_BINARY), {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
        [constants.BROTLI_PARAM_LGWIN]: 22,
      },
    });

    const plain = decompressor.decompress(new Uint8Array(compressed));
    expect(Array.from(plain)).toEqual(Array.from(FIXTURE_BINARY));
  });

  test("enforces maxOutputSize", () => {
    expect(() =>
      decompressor.decompress(FIXTURE_TEXT_BROTLI, { maxOutputSize: 8 }),
    ).toThrowError(expect.objectContaining({ constructor: Error, message: expect.stringMatching(/max_output_size/) }));
  });

  // Regression: wasm-bindgen wrapped 2^32 + 8 to 8 (spurious limit error) and 2^32 to 0.
  test("maxOutputSize above the 32-bit range is not wrapped", () => {
    for (const maxOutputSize of [2 ** 32, 2 ** 32 + 8]) {
      expect(decompressor.decompressText(FIXTURE_TEXT_BROTLI, { maxOutputSize })).toBe(FIXTURE_TEXT);
    }
  });

  // The wasm32 decoder's arena allocator rewinds only when every allocation is freed. A leak on any path would
  // keep ~4 MiB per call alive and exhaust the 4 GiB WASM memory long before 1,100 calls.
  test("repeated calls, including failing ones, do not leak WASM memory", () => {
    const big = new Uint8Array(brotliCompressSync(Buffer.alloc(4 * 1024 * 1024, 7)));
    for (let i = 0; i < 1100; i++) {
      expect(decompressor.decompress(big).length).toBe(4 * 1024 * 1024);
      expect(() => decompressor.decompress(big, { maxOutputSize: 1024 })).toThrowError(/max_output_size/);
      expect(() => decompressor.decompress(big.subarray(0, big.length - 1))).toThrowError(/truncated/);
    }
  });

  // 8 MiB of about 8:1 text: each 1 MiB output chunk fills while most of the ~1 MiB input chunk is still unread.
  test("decodes streams whose output chunk fills before the input chunk is consumed", () => {
    const text = Buffer.from(
      Array.from({ length: 160_000 }, (_, i) => `{"id":${(i * 2654435761) % 1e9},"n":${i},"ok":${i % 3 === 0}}`).join("\n"),
    ).subarray(0, 8 * 1024 * 1024);
    const packed = new Uint8Array(brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }));
    expect(packed.length).toBeGreaterThan(512 * 1024);
    const plain = decompressor.decompress(packed);
    expect(Buffer.from(plain.buffer, plain.byteOffset, plain.length).equals(text)).toBe(true);
  });

  test("isReady() returns true after init", () => {
    expect(decompressor.isReady()).toBe(true);
  });

  test("decompresses empty compressed payload to empty output", () => {
    const compressed = compressor.compress(new Uint8Array(0));
    const plain = decompressor.decompress(compressed);
    expect(plain.length).toBe(0);
  });

  // Regression: WASM errors crossed into JS as bare strings without `message` or stack.
  test("throws an Error on corrupt / non-Brotli input", () => {
    const garbage = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xFF]);
    expect(() => decompressor.decompress(garbage)).toThrowError(expect.objectContaining({
      constructor: Error,
      message: "invalid brotli stream",
    }));
  });

  test("throws an Error on truncated input", () => {
    expect(() => decompressor.decompress(FIXTURE_TEXT_BROTLI.subarray(0, 20))).toThrowError(
      expect.objectContaining({ constructor: Error, message: "truncated brotli stream" }),
    );
  });
});

describe("decompressor normalizeOptions", () => {
  test("maxOutputSize 1 is accepted", () => {
    expect(() => decompressor.normalizeOptions({ maxOutputSize: 1 })).not.toThrow();
  });

  test("maxOutputSize 0 throws", () => {
    expect(() => decompressor.normalizeOptions({ maxOutputSize: 0 })).toThrow("maxOutputSize");
  });

  test("maxOutputSize -1 throws", () => {
    expect(() => decompressor.normalizeOptions({ maxOutputSize: -1 })).toThrow("maxOutputSize");
  });

  test("non-integer maxOutputSize throws", () => {
    expect(() => decompressor.normalizeOptions({ maxOutputSize: 1.5 })).toThrow("maxOutputSize");
  });
});
