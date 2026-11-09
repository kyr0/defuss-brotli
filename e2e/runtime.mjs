// Consumer of the packed tarball: `make e2e` installs it into a clean project next to this file and runs it with
// Node.js and with Bun. Round-trips every input/ file through every entry point, cross-checked against node:zlib.
// usage: node|bun runtime.mjs <input-dir> <output-file>
import assert from "node:assert/strict";
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import * as compressor from "defuss-brotli/compressor";
import * as decompressor from "defuss-brotli/decompressor";

const [inputDir, outputFile] = process.argv.slice(2);
assert.throws(() => compressor.compress(new Uint8Array(1)), /not initialized/);
assert.throws(() => decompressor.decompress(new Uint8Array(1)), /not initialized/);
await Promise.all([compressor.init(), decompressor.init()]);
assert.ok(compressor.isReady() && decompressor.isReady());

const results = [];
for (const file of readdirSync(inputDir).sort()) {
  const data = new Uint8Array(readFileSync(join(inputDir, file)));
  for (const quality of [0, 1, 6, 11]) {
    const packed = compressor.compress(data, { quality });
    assert.deepEqual(decompressor.decompress(packed), data, `${file} q${quality} round-trip`);
    assert.deepEqual(new Uint8Array(brotliDecompressSync(packed)), data, `${file} q${quality} node:zlib decode`);
    results.push({ file, quality, inputBytes: data.length, outputBytes: packed.length });
  }
  assert.deepEqual(decompressor.decompress(new Uint8Array(brotliCompressSync(data))), data, `${file} node:zlib encode`);
  assert.throws(() => decompressor.decompress(compressor.compress(data), { maxOutputSize: Math.max(1, data.length - 1) }));
}

const text = readFileSync(join(inputDir, "page.html"), "utf8");
assert.equal(decompressor.decompressText(compressor.compressText(text, { quality: 9, lgwin: 16 })), text);
assert.throws(() => compressor.compressText(text, { quality: 12 }), /quality/);
assert.throws(() => decompressor.decompress(Uint8Array.of(0xde, 0xad, 0xbe, 0xef)));

// /slim entries: the default init() reads the .wasm next to the module; the .wasm exports resolve to the same files.
const slimCompressor = await import("defuss-brotli/compressor/slim");
const slimDecompressor = await import("defuss-brotli/decompressor/slim");
assert.throws(() => slimCompressor.compress(new Uint8Array(1)), /not initialized/);
await slimCompressor.init();
await slimDecompressor.init(readFileSync(new URL(import.meta.resolve("defuss-brotli/decompressor.wasm"))));
const slimPacked = slimCompressor.compressText(text, { quality: 6 });
assert.equal(slimDecompressor.decompressText(slimPacked), text);
assert.equal(decompressor.decompressText(slimPacked), text, "slim and inline builds are interchangeable");
results.push({ file: "page.html", entry: "slim", quality: 6, inputBytes: Buffer.byteLength(text), outputBytes: slimPacked.length });

// README "Quick Start", verbatim.
assert.equal(decompressor.decompressText(compressor.compressText("Hello, Brotli!", { quality: 6 })), "Hello, Brotli!");

// README "Decompression Options" and "Limits": the 64 MiB default cap, raising it, and caps beyond 32 bits.
const overDefault = new Uint8Array(brotliCompressSync(Buffer.alloc(decompressor.DEFAULT_MAX_OUTPUT_SIZE + 1)));
assert.throws(() => decompressor.decompress(overDefault), /max_output_size/);
assert.equal(decompressor.decompress(overDefault, { maxOutputSize: 128 * 1024 * 1024 }).length, decompressor.DEFAULT_MAX_OUTPUT_SIZE + 1);
assert.equal(decompressor.decompressText(slimPacked, { maxOutputSize: 2 ** 40 }), text);

// README "Inlined or separate .wasm": every init(source) form, each on a fresh module instance (init runs once).
// The slim module is one self-contained file, so a copy is a fresh instance; Bun ignores `?query` cache-busting.
const slimFile = new URL(import.meta.resolve("defuss-brotli/decompressor/slim"));
const freshSlim = (tag) => {
  const copy = new URL(`./fresh-${tag}.js`, import.meta.url);
  copyFileSync(slimFile, copy);
  return import(copy.href);
};
const wasmUrl = new URL(import.meta.resolve("defuss-brotli/decompressor.wasm"));
const { readFile } = await import("node:fs/promises");
for (const [tag, source] of [
  ["file-url", () => wasmUrl],
  ["file-url-string", () => wasmUrl.href],
  ["bytes", async () => readFile(wasmUrl)],
  ["module", async () => WebAssembly.compile(await readFile(wasmUrl))],
  ["response", async () => new Response(await readFile(wasmUrl), { headers: { "Content-Type": "application/wasm" } })],
]) {
  const instance = await freshSlim(tag);
  assert.equal(instance.isReady(), false, `${tag}: fresh instance`);
  await instance.init(await source());
  assert.equal(instance.decompressText(slimPacked), text, `${tag}: init(source)`);
  results.push({ file: "page.html", entry: "slim", init: tag });
}

const runtime = globalThis.Bun ? `bun ${globalThis.Bun.version}` : `node ${process.version}`;
writeFileSync(outputFile, `${JSON.stringify({ runtime, results }, null, 2)}\n`);
console.log(`${new Date().toISOString()} INFO e2e.runtime passed runtime="${runtime}" cases=${results.length} output=${outputFile}`);
