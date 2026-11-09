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
    // compressParallel on Web Workers started from a Blob URL. VERIFIED: bun build, Vite (build and dev) and the CDN
    // import map all run the embedded worker without copying a worker file, with the calling thread's bytes.
    const big = new TextEncoder().encode(text.repeat(12));
    for (const [entry, c, d] of [["inline", compressor, decompressor], ["slim", slimCompressor, slimDecompressor]]) {
      const parallel = await c.compressParallel(big, { threads: 4 });
      const sequential = await c.compressParallel(big, { threads: 1 });
      if (d.decompressText(parallel) !== text.repeat(12)) throw new Error(`${entry} compressParallel round-trip failed`);
      if (parallel.join() !== sequential.join()) throw new Error(`${entry} compressParallel depends on threads`);
      results.push({ entry, parallel: true, inputChars: big.length, outputBytes: parallel.length });
    }
    return { bundler, runtime: navigator.userAgent, results };
  };
}
