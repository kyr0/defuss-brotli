import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { beforeAll, describe, expect, test } from "vitest";
import { FIXTURE_BINARY, FIXTURE_TEXT } from "./fixtures";
import * as compressor from "./compressor";
import { partRanges } from "./compressor-core";

const FIXTURE_TEXT_BYTES = new TextEncoder().encode(FIXTURE_TEXT);
import * as decompressor from "./decompressor";

beforeAll(async () => {
  await compressor.init();
  await decompressor.init();
});

describe("compressor", () => {
  // lgwin 10 makes 1 KiB input chunks, so 64 KiB cross many chunk boundaries; at quality 2 and above some
  // steps only buffer input and produce no output.
  test("round-trips input spanning many windows at every quality", () => {
    const input = new TextEncoder().encode(
      Array.from({ length: 1500 }, (_, i) => `<li data-id="${(i * 7919) % 1000}">item ${i}</li>`).join("\n"),
    ).subarray(0, 64 * 1024);
    for (let quality = 0; quality <= 11; quality++) {
      const packed = compressor.compress(input, { quality, lgwin: 10 });
      expect(Buffer.from(brotliDecompressSync(packed)).equals(input), `quality ${quality}`).toBe(true);
    }
  });

  test("compresses UTF-8 text that Node.js can decode", () => {
    const compressed = compressor.compressText(FIXTURE_TEXT, {
      quality: 6,
      lgwin: 22,
    });

    const plain = brotliDecompressSync(Buffer.from(compressed)).toString("utf8");
    expect(plain).toBe(FIXTURE_TEXT);
  });

  test("round-trips text through the wasm compressor and decompressor", () => {
    const compressed = compressor.compressText(FIXTURE_TEXT);
    const plain = decompressor.decompressText(compressed);
    expect(plain).toBe(FIXTURE_TEXT);
  });

  test("round-trips binary bytes through the wasm compressor and decompressor", () => {
    const compressed = compressor.compress(FIXTURE_BINARY, {
      quality: 4,
      lgwin: 20,
    });
    const plain = decompressor.decompress(compressed);
    expect(Array.from(plain)).toEqual(Array.from(FIXTURE_BINARY));
  });

  test("isReady() returns true after init", () => {
    expect(compressor.isReady()).toBe(true);
  });

  test("compress and decompress empty Uint8Array round-trips", () => {
    const compressed = compressor.compress(new Uint8Array(0));
    const plain = decompressor.decompress(compressed);
    expect(plain.length).toBe(0);
  });

  test("compressText and decompressText empty string round-trips", () => {
    const compressed = compressor.compressText("");
    const plain = decompressor.decompressText(compressed);
    expect(plain).toBe("");
  });

  test("round-trips multi-byte Unicode (emoji + CJK + Arabic)", () => {
    const unicode = "Hello 🌍🎉 你好世界 مرحبا 🚀 café naïve";
    const compressed = compressor.compressText(unicode);
    const plain = decompressor.decompressText(compressed);
    expect(plain).toBe(unicode);
  });

  // Regression: 4 KiB streaming chunks made quality 0-1 miss every repeat that crossed a chunk boundary.
  test("fast qualities match repeats across 4 KiB chunks", () => {
    let x = 0x9e3779b9; // xorshift32: incompressible on its own, so only cross-chunk matches shrink it
    const block = Uint8Array.from({ length: 4096 }, () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x & 0xff;
    });
    const input = new Uint8Array(8 * 4096);
    for (let i = 0; i < 8; i++) input.set(block, i * 4096);
    for (const quality of [0, 1]) {
      const compressed = compressor.compress(input, { quality });
      expect(compressed.length).toBeLessThan(2 * 4096);
      expect(decompressor.decompress(compressed)).toEqual(input);
    }
  });

  test("quality 11 produces output ≤ quality 1 for compressible text", () => {
    const longText = "abcdefghij".repeat(200);
    const q1 = compressor.compressText(longText, { quality: 1 });
    const q11 = compressor.compressText(longText, { quality: 11 });
    expect(q11.length).toBeLessThanOrEqual(q1.length);
  });
});

// Text with repeats near and far, so that dropping the dictionary of a part would show in the size.
function webText(bytes: number): Uint8Array {
  const rows = Array.from({ length: bytes / 40 }, (_, i) => `<tr><td>${(i * 7919) % 5003}</td><td>row</td></tr>`);
  return new TextEncoder().encode(rows.join("\n")).subarray(0, bytes);
}

describe("compressParallel", () => {
  test("splits into at most 8 parts of at least 32 KiB, and not below quality 10", () => {
    expect(partRanges(32 * 1024, 11)).toEqual([[0, 32 * 1024]]);
    expect(partRanges(32 * 1024 + 1, 11)).toEqual([[0, 32 * 1024], [32 * 1024, 32 * 1024 + 1]]);
    expect(partRanges(800_000, 11)).toHaveLength(8);
    expect(partRanges(800_000, 11).at(-1)).toEqual([700_000, 800_000]);
    expect(partRanges(800_000, 9)).toEqual([[0, 800_000]]);
    expect(partRanges(800_000, 10)).toHaveLength(8);
    expect(partRanges(0, 11)).toEqual([[0, 0]]);
  });

  test("joins parts into one stream that node:zlib decodes, the same for every thread count", async () => {
    const input = webText(300_000);
    const parallel = await compressor.compressParallel(input);
    expect(brotliDecompressSync(parallel).equals(input)).toBe(true);
    for (const threads of [1, 2, 3]) {
      expect(Buffer.from(await compressor.compressParallel(input, { threads })).equals(parallel), `${threads}`).toBe(true);
    }
  });

  test("equals compress() for one part and below quality 10", async () => {
    const input = webText(300_000);
    expect(await compressor.compressParallel(FIXTURE_TEXT_BYTES)).toEqual(compressor.compress(FIXTURE_TEXT_BYTES));
    expect(await compressor.compressParallel(input, { quality: 9 })).toEqual(compressor.compress(input, { quality: 9 }));
  });

  // Regression: parts of this SVG at quality 5 and 6 trapped in the encoder (a brotli crate bug with dictionaries),
  // and freeing the trapped encoder replaced the error with "attempted to take ownership of Rust value".
  test("compresses the SVG fixture at every quality", async () => {
    const svg = new Uint8Array(readFileSync(new URL("../huge.svg", import.meta.url))).subarray(0, 1024 * 1024);
    for (let quality = 0; quality <= 11; quality++) {
      const packed = await compressor.compressParallel(svg, { quality });
      expect(brotliDecompressSync(packed).equals(svg), `quality ${quality}`).toBe(true);
    }
  });

  // Regression: Buffer#slice shares memory, so transferring parts made with it detached the caller's Buffer.
  test("leaves a Buffer input intact", async () => {
    const input = Buffer.from(webText(100_000));
    const before = Buffer.from(input);
    const packed = await compressor.compressParallel(input, { lgwin: 16 });
    expect(input.equals(before)).toBe(true);
    expect(brotliDecompressSync(packed).equals(before)).toBe(true);
  });

  test("rejects a thread count that is not a positive integer", async () => {
    await expect(compressor.compressParallel(FIXTURE_TEXT_BYTES, { threads: 0 })).rejects.toThrow("threads");
    await expect(compressor.compressParallel(FIXTURE_TEXT_BYTES, { threads: 1.5 })).rejects.toThrow("threads");
  });
});

describe("compressor normalizeOptions", () => {
  test("defaults to quality 11 and window 22, the defaults of Node.js zlib", () => {
    expect(compressor.normalizeOptions()).toEqual({ quality: 11, lgwin: 22 });
    expect(compressor.compressText(FIXTURE_TEXT)).toEqual(compressor.compressText(FIXTURE_TEXT, { quality: 11, lgwin: 22 }));
  });

  test("quality 0 is accepted", () => {
    expect(() => compressor.normalizeOptions({ quality: 0 })).not.toThrow();
  });

  test("quality 11 is accepted", () => {
    expect(() => compressor.normalizeOptions({ quality: 11 })).not.toThrow();
  });

  test("quality 12 throws", () => {
    expect(() => compressor.normalizeOptions({ quality: 12 })).toThrow("quality");
  });

  test("quality -1 throws", () => {
    expect(() => compressor.normalizeOptions({ quality: -1 })).toThrow("quality");
  });

  test("lgwin 10 is accepted", () => {
    expect(() => compressor.normalizeOptions({ lgwin: 10 })).not.toThrow();
  });

  test("lgwin 24 is accepted", () => {
    expect(() => compressor.normalizeOptions({ lgwin: 24 })).not.toThrow();
  });

  test("lgwin 9 throws", () => {
    expect(() => compressor.normalizeOptions({ lgwin: 9 })).toThrow("lgwin");
  });

  test("lgwin 25 throws", () => {
    expect(() => compressor.normalizeOptions({ lgwin: 25 })).toThrow("lgwin");
  });

  test("non-integer quality throws", () => {
    expect(() => compressor.normalizeOptions({ quality: 3.5 })).toThrow("quality");
  });
});
