// Decompress-only `bun build` app: the slim decoder's .wasm comes from a `with { type: "file" }` import.
import decompressorWasm from "defuss-brotli/decompressor.wasm" with { type: "file" };
import { expose, slimDecompressor } from "./decompress.mjs";

expose("bun build, decompressor only", () => slimDecompressor.init(decompressorWasm));
