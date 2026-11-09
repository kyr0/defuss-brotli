// Shared by the bundler apps (bun-entry.mjs, vite-entry.mjs): exposes runE2e(text) for e2e/browser.mjs, which
// round-trips the text through the inline and the slim entry points after each app initialized them its own way.
import * as compressor from "defuss-brotli/compressor";
import * as decompressor from "defuss-brotli/decompressor";
import * as slimCompressor from "defuss-brotli/compressor/slim";
import * as slimDecompressor from "defuss-brotli/decompressor/slim";

export { slimCompressor, slimDecompressor };

export function expose(bundler, initSlim) {
  globalThis.runE2e = async (text) => {
    await Promise.all([compressor.init(), decompressor.init(), initSlim()]);
    const results = [];
    for (const [entry, c, d] of [["inline", compressor, decompressor], ["slim", slimCompressor, slimDecompressor]]) {
      for (const quality of [0, 1, 6, 11]) {
        const packed = c.compressText(text, { quality });
        if (d.decompressText(packed) !== text) throw new Error(`${entry} round-trip failed at quality ${quality}`);
        results.push({ entry, quality, inputChars: text.length, outputBytes: packed.length });
      }
    }
    return { bundler, runtime: navigator.userAgent, results };
  };
}
