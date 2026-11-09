// Bun bundler app. `with { type: "file" }` makes `bun build` copy decompressor.wasm into the output and return its
// path. The compressor uses the default init(); Bun keeps `new URL("./compressor.wasm", import.meta.url)` as is, so
// `make e2e` copies compressor.wasm next to the bundle, as the README tells Bun users to.
import decompressorWasm from "defuss-brotli/decompressor.wasm" with { type: "file" };
import { expose, slimCompressor, slimDecompressor } from "./roundtrip.mjs";

expose("bun build", () => Promise.all([slimCompressor.init(), slimDecompressor.init(decompressorWasm)]));
