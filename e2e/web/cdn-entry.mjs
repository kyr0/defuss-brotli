// Unbundled app that loads the package from a CDN origin through an import map (cdn.html), as with jsDelivr.
// The README's `init(fetch(url))` form loads the decoder; the compressor uses its default init(), which resolves
// compressor.wasm next to compressor-slim.js on the CDN.
import { expose, slimCompressor, slimDecompressor } from "./roundtrip.mjs";

const CDN = "http://cdn.test/npm/defuss-brotli/dist/";
expose("cdn import map", () => Promise.all([slimCompressor.init(), slimDecompressor.init(fetch(`${CDN}decompressor.wasm`))]));
