// Shared by the decompress-only apps: imports nothing but the two decompressor entry points, so `make e2e` can
// check that such an app neither bundles nor fetches any compressor code. The harness passes the text and its
// Brotli encoding from node:zlib, an encoder independent of this package.
import * as decompressor from "defuss-brotli/decompressor";
import * as slimDecompressor from "defuss-brotli/decompressor/slim";

export { slimDecompressor };

export function expose(bundler, initSlim) {
  globalThis.runE2e = async (text, packed) => {
    await Promise.all([decompressor.init(), initSlim()]);
    const bytes = Uint8Array.from(packed);
    const results = [];
    for (const [entry, d] of [["inline", decompressor], ["slim", slimDecompressor]]) {
      if (d.decompressText(bytes) !== text) throw new Error(`${entry} decompressor returned different text`);
      results.push({ entry, inputBytes: bytes.length, outputChars: text.length });
    }
    return { bundler, runtime: navigator.userAgent, results };
  };
}
