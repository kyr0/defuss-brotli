import { beforeAll, describe, expect, test } from "vitest";

import { FIXTURE_TEXT } from "./fixtures";
import * as compressor from "./compressor";
import * as decompressor from "./decompressor";

beforeAll(async () => {
  await compressor.init();
  await decompressor.init();
});

describe("compressor (browser)", () => {
  test("compressParallel runs parts on Web Workers and joins one stream", async () => {
    const text = Array.from({ length: 9000 }, (_, i) => `<li>${(i * 7919) % 5003} parallel</li>`).join("");
    const parallel = await compressor.compressParallel(new TextEncoder().encode(text), { threads: 4 });
    expect(decompressor.decompressText(parallel)).toBe(text);
    const sequential = await compressor.compressParallel(new TextEncoder().encode(text), { threads: 1 });
    expect(parallel).toEqual(sequential);
  });

  test("round-trips web text in the browser", () => {
    const compressed = compressor.compressText(FIXTURE_TEXT, {
      quality: 6,
      lgwin: 22,
    });
    const plain = decompressor.decompressText(compressed);
    expect(plain).toBe(FIXTURE_TEXT);
  });

  test("round-trips empty string in the browser", () => {
    const compressed = compressor.compressText("");
    const plain = decompressor.decompressText(compressed);
    expect(plain).toBe("");
  });

  test("round-trips emoji + multi-byte Unicode in the browser", () => {
    const text = "Hello 🌍🎉 你好世界 مرحبا 🚀";
    const compressed = compressor.compressText(text);
    const plain = decompressor.decompressText(compressed);
    expect(plain).toBe(text);
  });
});
