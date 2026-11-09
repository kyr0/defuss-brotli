// Unbundled decompress-only app on a CDN origin: the slim decoder's default init() fetches decompressor.wasm
// from next to decompressor-slim.js on the CDN.
import { expose, slimDecompressor } from "./decompress.mjs";

expose("cdn import map, decompressor only", () => slimDecompressor.init());
