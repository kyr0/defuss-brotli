// Decompress-only Vite app: the slim decoder uses its default init(), whose .wasm Vite emits itself.
import { expose, slimDecompressor } from "./decompress.mjs";

expose("vite, decompressor only", () => slimDecompressor.init());
