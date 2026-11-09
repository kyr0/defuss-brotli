// Vite app, served by `vite` (dev) and built by `vite build`. The compressor uses the default init(), whose
// `new URL("./compressor.wasm", import.meta.url)` Vite resolves itself; the decompressor gets its URL from `?url`.
import decompressorWasm from "defuss-brotli/decompressor.wasm?url";
import { expose, slimCompressor, slimDecompressor } from "./roundtrip.mjs";

expose("vite", () => Promise.all([slimCompressor.init(), slimDecompressor.init(decompressorWasm)]));
