# Changelog

All notable changes to `defuss-brotli`. Versions follow [Semantic Versioning](https://semver.org/); before 1.0.0, a minor version may change behavior.

## 0.3.0 - 2026-11-09

### Changed

- **The default compression quality is now 11 instead of 6**, the default of Node.js zlib (`BROTLI_DEFAULT_QUALITY`) and of the `brotli` CLI. `compress()` and `compressText()` calls that pass no `quality` now return the smallest output and take longer: about 3.8 s instead of 0.15 s for a 5.1 MB SVG (Node.js 26). Pass `{ quality: 6 }` to keep the previous output.
- The compressor entry points embed the worker script of `compressParallel`: `compressor-slim.js` grows from 4.8 KB to 15.2 KB and `compressor.wasm` by 11.5 KB (raw). The decompressor entry points grow by 29 B.

### Added

- `compressParallel(input, options)` compresses up to 8 parts of the input at once on workers, each with its own instance of the compressor, and joins them into one standard Brotli stream. At quality 11 it is 2.3 to 4.3 times faster than `compress` from 256 KiB, with output 0.01 to 0.10 % larger (Node.js 26). The output depends only on the input, `quality` and `lgwin`, not on `threads` or the machine. It also exports `BrotliParallelOptions`, `PARALLEL_PARTS` and `MIN_PART_SIZE`.
- The `defuss-brotli` command (`bunx defuss-brotli compress FILE`, `bunx defuss-brotli decompress FILE.br`) takes the options, defaults, output names and refusals of the `brotli` 1.2.0 CLI. It compresses with `compressParallel`; `--threads=NUM` sets the number of workers. From 256 KiB it compresses 1.2 to 5.3 times faster than `brotli` 1.2.0, depending on the input and runtime. `--large_window`, `--comment`, `--dictionary` and `--concatenated` are not supported.
- `CHANGELOG.md`, shipped in the package.

## 0.2.0 - 2026-11-09

### Added

- `/slim` entry points, `defuss-brotli/compressor/slim` and `defuss-brotli/decompressor/slim`, with the same API as the inline ones. They load the binary from a separate `.wasm` file (`defuss-brotli/compressor.wasm`, `defuss-brotli/decompressor.wasm`): by default from next to the module, or from a URL, a `Response`, bytes or a compiled `WebAssembly.Module` passed to `init()`.
- `THIRD_PARTY_NOTICES.txt` with the license texts of the code compiled into the `.wasm` files.

### Changed

- Both modules stream input and output through fixed chunks in WASM memory, so linear memory no longer grows with the payload: it holds 19.6 MiB after decoding 100 MiB, and 69 MiB after compressing it at quality 6.
- The compressor feeds the encoder one window per call instead of 4 KiB, so qualities 0 and 1 find repeats across chunks (a 28 KiB page at quality 1: 1,189 B instead of 3,853 B); the output equals one encoder call over the whole input at every quality.
- The decoder is built without the Rust standard library, which brings `defuss-brotli/decompressor/slim` to about 51 KB with Brotli quality 11 (85 KB from jsDelivr).
- `bun run build`, and with it `npm publish`, finds the pinned build tools without an activated mise.

## 0.1.1 to 0.1.3

These releases predate this repository's history.
