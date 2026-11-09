# `defuss-brotli`

A split pure-Rust Brotli package for Node.js + browsers.

- **Small browser decoder** - `defuss-brotli/decompressor/slim` loads only the decoder: about 51 KB precompressed with Brotli quality 11 and 85 KB from jsDelivr (quality 4), most of it the Brotli dictionary every decoder carries
- **Separate heavier encoder bundle** - used server-side or at build time
- **Single NPM package** with split exports
- **Inlined or separate `.wasm`** - one self-contained file by default, or a `/slim` entry that loads the binary on its own
- **Pure-Rust WebAssembly** - no native addons
- **Typed TypeScript API** with full JSDoc
- **Vitest coverage** in Node and browser

## Install

```bash
bun add defuss-brotli
```

## Quick Start

### Compress

```ts
import { init, compressText } from "defuss-brotli/compressor";

await init();

const compressed = compressText("Hello, Brotli!", { quality: 6 });
```

### Decompress

```ts
import { init, decompressText } from "defuss-brotli/decompressor";

await init();

const text = decompressText(compressed);
// returns "Hello, Brotli!"
```

### Inlined or separate `.wasm`

Each module comes in two builds with the same API. The default entry points embed the WASM binary as base64, so one JavaScript file is all a runtime or bundler needs. The `/slim` entry points leave the binary in its own `.wasm` file, which HTTP caches independently of your JavaScript, which compiles while it downloads when served as `application/wasm`, and which transfers 21 to 45 % fewer bytes depending on module and transfer encoding (see [Download sizes and budgets](#download-sizes-and-budgets)).

Without an argument, a slim `init()` loads the `.wasm` file from next to its module, via `new URL("./decompressor.wasm", import.meta.url)`. Browsers fetch it from there, and Node.js 20.16+ / 22.3+ and Bun read it from disk:

```ts
import { init, decompressText } from "defuss-brotli/decompressor/slim";

await init();
```

When your bundler or server does not place the file next to the bundle, copy `defuss-brotli/decompressor.wasm` (or `compressor.wasm`) to where you serve static assets and pass its location, or pass the response, the bytes or a compiled module:

```ts
await init("/assets/decompressor.wasm");            // URL, fetched (streamed when served as application/wasm)
await init(fetch("https://cdn.example.com/d.wasm")); // Response or Promise<Response>
await init(await readFile(wasmPath));                // ArrayBuffer or typed array
await init(compiledModule);                          // WebAssembly.Module
```

`init()` loads once; later calls return the first Promise and ignore their argument. After a failed load (for example a 404), the next call tries again.

#### Bundlers

`make e2e` builds a clean app per bundler from the packed tarball and runs it in Chromium:

| Bundler | `init()` without an argument | Explicit asset import |
|---|---|---|
| Vite 8.3.6, `vite build` and `vite` dev | works: Vite resolves `new URL(..., import.meta.url)` and emits the `.wasm` | `import url from "defuss-brotli/decompressor.wasm?url"`, then `init(url)` |
| `bun build` (Bun 1.4) | copy `compressor.wasm` / `decompressor.wasm` next to the bundle yourself: Bun leaves `new URL(...)` unchanged | `import url from "defuss-brotli/decompressor.wasm" with { type: "file" }`, then `init(url)` |

With an explicit import, the bundler copies the file and gives it a hashed name, so it can be cached long-term. Node.js and Bun as runtimes need neither: `init()` reads the file from `node_modules`.

## API

### `compress` vs `compressText`

| Function | Input | Encoding | When to use |
|---|---|---|---|
| `compress(bytes, opts)` | `Uint8Array` | None - bytes pass through as-is | Binary data, files, pre-encoded buffers |
| `compressText(text, opts)` | `string` | `TextEncoder` (UTF-8) applied internally | JSON, HTML, Markdown, any JS string |

**Why `TextEncoder`?** JS strings are UTF-16 internally, but Brotli operates on
raw bytes. `TextEncoder` converts to canonical UTF-8 - the standard encoding for
web text. `compressText` handles this so you don't have to.

### `decompress` vs `decompressText`

| Function | Output | Decoding | When to use |
|---|---|---|---|
| `decompress(bytes, opts)` | `Uint8Array` | None - raw bytes returned | Binary data, custom decoding |
| `decompressText(bytes, opts)` | `string` | `TextDecoder` (UTF-8) applied internally | Text that was compressed with `compressText` |

**Why `TextDecoder`?** Reverses the `TextEncoder` step. If the bytes are not
valid UTF-8, replacement characters (U+FFFD) are inserted rather than throwing.

### Compression Options

```ts
interface BrotliCompressOptions {
  quality?: number;  // 0-11, default 6
  lgwin?: number;    // 10-24, default 22
}
```

- **`quality`** - 0 is fastest/largest, 11 is slowest/smallest. 5-7 is the sweet spot for on-the-fly web serving.
- **`lgwin`** - Sliding window size exponent. Larger windows find more matches at the cost of memory. 22 covers most web-text repetition patterns.

### Decompression Options

```ts
interface BrotliDecompressOptions {
  maxOutputSize?: number;  // default 64 MiB (67_108_864)
}
```

Hard cap on decompressed output to prevent **decompression bombs**. Raise explicitly if your payloads legitimately exceed 64 MiB.

## Assumptions, Guarantees, Limits

### Assumptions

- Compressed input was produced by a **valid Brotli encoder** (this library, Node.js `zlib`, nginx, etc.).
- Text payloads compressed with `compressText` are valid **UTF-8** when decompressed.

### Guarantees

- `decompressText(compressText(s))` returns `s` exactly for any JS string.
- `decompress(compress(b))` returns the same bytes as `b` for any `Uint8Array`.
- `init()` is **idempotent** - calling it multiple times returns the same Promise and does not reload WASM.
- Importing only `defuss-brotli/decompressor` (or `/decompressor/slim`) **never loads** the encoder WASM binary.
- Inline and `/slim` builds of a module run the same code and produce identical output.

### Limits

- `quality` must be an integer in **0-11** (the range of the reference Brotli encoder).
- `lgwin` must be an integer in **10-24** (the window range of the Brotli format, RFC 7932).
- `maxOutputSize` defaults to **64 MiB** - the WASM module rejects output exceeding this. Values above 2^32 − 1 act as 2^32 − 1.
- Calls stream the input and output through chunks of at most 1 MiB (one window of input when compressing), so WASM memory holds the codec state and two chunks however large the payload; the returned `Uint8Array` lives in JavaScript memory. Truncated input, corrupt input and bytes after the end of the Brotli stream throw.

## Why the Split Exports?

The encoder and decoder are built from **two separate Rust Wasm crates**: `brotli` behind `defuss-brotli/compressor` (server-side, build pipelines) and `brotli-decompressor` behind `defuss-brotli/decompressor` (browser clients). The encoder needs large static tables the decoder does not, so browser apps that only decompress pre-compressed data import just the decompressor and download about a sixth of the bytes. [ARCH.md](ARCH.md) explains where the sizes come from and why the build trades 1 % of size for speed.

## Download sizes and budgets

What a browser downloads for one import, with each file transfer-compressed on its own, as a CDN or web server does per response:

| Import | Files | raw | gzip -9 | brotli q4 (jsDelivr) | brotli q11 | zstd -19 |
|---|---|---:|---:|---:|---:|---:|
| `defuss-brotli/decompressor/slim` | `decompressor-slim.js` + `decompressor.wasm` | 190,260 B | 85,609 B | 85,064 B | 50,801 B | 78,590 B |
| `defuss-brotli/decompressor` | `decompressor.js` | 252,184 B | 109,982 B | 111,509 B | 92,957 B | 101,421 B |
| `defuss-brotli/compressor/slim` | `compressor-slim.js` + `compressor.wasm` | 938,084 B | 447,231 B | 503,917 B | 394,522 B | 400,635 B |
| `defuss-brotli/compressor` | `compressor.js` | 1,249,264 B | 599,668 B | 655,950 B | 500,472 B | 520,192 B |

- **gzip -9** and **brotli q4** are what [jsDelivr](https://www.jsdelivr.com/) sends: measured on 2026-11-09, its brotli responses match quality 4 byte for byte and its gzip responses lie within 0.1 % of levels 6 to 9. jsDelivr serves `.wasm` files as `application/wasm` with `access-control-allow-origin: *`, and serves no zstd.
- **brotli q11** and **zstd -19** are what precompressed static hosting reaches (for example `.br` files next to the assets, or a CDN that compresses at its highest level). Quality 11 is unstable on `compressor.wasm`: passes of `wasm-opt` that change its raw size and its quality-4 size by 0.2 % move it between 340,693 B and 392,638 B, so its budget allows the upper value.
- `make metrics` prints these numbers for `dist/`. `make e2e` measures the packed tarball and fails when an import exceeds its limit in [`size-budgets.json`](size-budgets.json) (current size plus 2 %); raise a limit only for a measured, intended change.

### From a CDN without a bundler

An [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) maps the package's exports to its files on jsDelivr; pin a version (`defuss-brotli@x.y.z`) in production. The slim `init()` then fetches `decompressor.wasm` from the same CDN directory:

```html
<script type="importmap">
  { "imports": { "defuss-brotli/decompressor/slim": "https://cdn.jsdelivr.net/npm/defuss-brotli/dist/decompressor-slim.js" } }
</script>
<script type="module">
  import { init, decompressText } from "defuss-brotli/decompressor/slim";

  await init();
</script>
```

`make e2e` runs this setup in Chromium against a second origin that serves the installed package with jsDelivr's headers.

## Benchmarks

Numbers are operations per second from `vitest bench` (higher is better), measured on 2026-11-08 on an Apple Silicon Mac with Node.js 26.11 and headless Chromium 158. Run them yourself with `make bench` (Node.js) and `bun run bench:browser` (Chromium).

**Compression** (`compressText` for text, `compress` for binary), Node.js / Chromium:

| Payload | Quality 1 | Quality 6 | Quality 11 |
|---|---|---|---|
| Short JSON (83 B) | - | 55,883 / 39,120 | - |
| Markdown (2 KB) | 61,300 / 46,437 | 21,410 / 17,654 | 502 / 428 |
| HTML (28 KB) | 33,120 / 22,730 | 10,548 / 8,962 | 20.6 / 18.9 |
| Pseudorandom (512 B) | - | 43,034 / 38,924 | - |
| SVG (4.9 MB) | 43.0 / 39.7 | 6.79 / 6.15 | 0.26 / 0.28 |
| PNG (2.1 MB) | 1,505 / 1,795 | 93.1 / 139 | 0.46 / 0.67 |

**Decompression** (`decompressText` for text, `decompress` for binary):

| Payload | Node.js | Chromium |
|---|---|---|
| Short JSON (83 B) | 140,803 | 190,084 |
| Markdown (2 KB) | 68,431 | 88,380 |
| HTML (28 KB) | 44,058 | 54,016 |
| Pseudorandom (512 B) | 120,529 | 146,854 |
| SVG (4.9 MB) | 66.9 | 77.0 |
| PNG (2.1 MB) | 873 | 993 |

### Large payloads (100 MB)

`bench/large.mjs` decompresses two inputs with `maxOutputSize: 128 * 1024 * 1024` (above the 64 MiB default): 100 MiB of generated JSON log lines, stored as a 13.3 MB Brotli file (quality 11, window 24), and a 100 MB Brotli file of incompressible bytes. "Warm" is the median of 5 calls on an initialized instance; "first call" is the first decompression on a fresh instance, which also grows and pages in WASM memory, as a one-off decode does. Native is `node:zlib`, the C Brotli library. Measured on 2026-11-09 on an Apple M5 Max:

| | Node.js 26.11 | Bun 1.4.3 | Chromium 158 |
|---|---:|---:|---:|
| 100 MiB text, warm (native) | 190 ms (132 ms) | 226 ms (141 ms) | 200 ms |
| 100 MiB text, first call | 193 ms | 272 ms | 223 ms |
| 100 MB Brotli file, warm (native) | 49 ms (11 ms) | 66 ms (7 ms) | 58 ms |
| 100 MB Brotli file, first call | 49 ms | 83 ms | 64 ms |
| WASM memory after decoding: text / file | 19.6 / 19.3 MiB | 19.6 / 19.3 MiB | 19.6 / 19.3 MiB |
| Compress the 100 MiB text at quality 6 (native) | 2,069 ms (1,173 ms) | 2,201 ms (1,021 ms) | - |
| WASM memory after compressing | 69 MiB | 69 MiB | - |
| Load + `init()`: `decompressor` / `decompressor/slim` | 2.7 / 1.3 ms | 2.6 / 1.9 ms | 3.0 / 2.2 ms |
| Load + `init()`: `compressor` / `compressor/slim` | 7.6 / 1.8 ms | 4.7 / 3.1 ms | 5.2 / 2.2 ms |

- Warm text decoding produces 440 to 530 MiB/s of output. Timings vary between runs by up to a third (native decoding of the text took 132 to 174 ms on the same machine), so compare builds within one session: interleaved with the previous whole-buffer build in Node.js, warm text decoding took 162 to 199 ms against 179 to 211 ms, faster in each of three rounds, and the file and compression times did not differ beyond noise.
- The incompressible file is mostly copying: into WASM memory, through the decoder's window and back out, which native code does once.
- WASM memory holds the decoder's window (16 MiB for these window-24 streams), its tables and two 1 MiB chunks, independent of the payload size. The previous whole-buffer build needed 283 MiB for the text and 320 MiB for the file, and kept that memory for the life of the instance, because WASM memory never shrinks. The compressor needed 214 MiB before and 69 MiB now: its encoder state at quality 6 plus one 4 MiB window of input and a 1 MiB output chunk.
- Chromium offers JavaScript no native Brotli decoder (`DecompressionStream` rejects `"brotli"` in Chromium 158); browsers decode Brotli natively only as HTTP `Content-Encoding`.
- Load + `init()` is measured from local files; over a network, the download sizes above add their transfer time.

`make bench` runs the suite and fails when a result exceeds [`bench/perf-budgets.json`](bench/perf-budgets.json): 2 times these timings (at least +5 ms) and 10 % above these memory sizes. Timings depend on the machine, so `make bench` is not part of `make verify`; recalibrate the budgets on other hardware.

## Examples

Run the quality comparison example to see compression ratios at different quality levels:

```bash
bun run example
```

Sample output:

```
════════════════════════════════════════════════════════════════════════
  Short JSON (~83 B)  (83 B input)
════════════════════════════════════════════════════════════════════════
  Quality  │      Output  │    Ratio  │  Compress ms  │  Decompress ms
  -------  │  ----------  │  -------  │  -----------  │  -------------
        1  │        87 B  │   104.8%  │         0.43  │           0.23  [OK]
        4  │        83 B  │   100.0%  │         0.36  │           0.20  [OK]
        6  │        80 B  │    96.4%  │         0.36  │           0.04  [OK]
        9  │        80 B  │    96.4%  │         1.88  │           0.04  [OK]
       11  │        85 B  │   102.4%  │         2.31  │           0.11  [OK]

════════════════════════════════════════════════════════════════════════
  Pseudorandom binary (512 B)  (512 B input)
════════════════════════════════════════════════════════════════════════
  Quality  │      Output  │    Ratio  │  Compress ms  │  Decompress ms
  -------  │  ----------  │  -------  │  -----------  │  -------------
        1  │       286 B  │    55.9%  │         0.08  │           1.22  [OK]
        4  │       278 B  │    54.3%  │         0.08  │           0.04  [OK]
        6  │       270 B  │    52.7%  │         0.08  │           0.03  [OK]
        9  │       259 B  │    50.6%  │         0.23  │           0.03  [OK]
       11  │       239 B  │    46.7%  │         1.57  │           0.15  [OK]

════════════════════════════════════════════════════════════════════════
  SVG (4.9 MB)  (4.9 MB input)
════════════════════════════════════════════════════════════════════════
  Quality  │      Output  │    Ratio  │  Compress ms  │  Decompress ms
  -------  │  ----------  │  -------  │  -----------  │  -------------
        1  │      1.9 MB  │    38.3%  │        25.21  │          35.76  [OK]
        4  │      1.8 MB  │    36.6%  │        75.33  │          33.47  [OK]
        6  │      1.8 MB  │    36.9%  │       158.53  │          30.81  [OK]
        9  │      1.8 MB  │    36.8%  │       516.73  │          28.96  [OK]
       11  │      1.7 MB  │    34.5%  │      3473.27  │          38.55  [OK]

════════════════════════════════════════════════════════════════════════
  PNG (2.1 MB)  (2.1 MB input)
════════════════════════════════════════════════════════════════════════
  Quality  │      Output  │    Ratio  │  Compress ms  │  Decompress ms
  -------  │  ----------  │  -------  │  -----------  │  -------------
        1  │      2.1 MB  │   100.0%  │         0.68  │          12.58  [OK]
        4  │      2.1 MB  │   100.0%  │         2.59  │           9.11  [OK]
        6  │      2.1 MB  │   100.0%  │         9.63  │           8.56  [OK]
        9  │      2.0 MB  │    99.0%  │       202.22  │          13.13  [OK]
       11  │      2.0 MB  │    96.2%  │      1556.99  │          24.54  [OK]

════════════════════════════════════════════════════════════════════════
  [OK] All round-trips passed
════════════════════════════════════════════════════════════════════════
```

**Key takeaways:**

- **SVG** (text-based) compresses well: the ratio falls from 38.3 % at quality 1 to 34.5 % at quality 11, while compression time grows from about 25 ms to about 3.5 s.
- **PNG** (already compressed) barely shrinks: about 100 % at qualities 1 to 6 and 96.2 % at quality 11, because its pixel data is already deflate-compressed.
- **Short text** can *grow* at low quality (104.8 % at quality 1): on an 83-byte payload the Brotli framing outweighs the savings.

## Defaults

For typical web text (JSON, Markdown, HTML, CSS, JS):

- `quality = 6`
- `lgwin = 22`

That is a sane point on the speed/ratio curve. Crank `quality` higher if you
need smaller output and can afford more CPU time.

## Build

### Prerequisites

The build needs [mise](https://mise.jdx.dev/), which installs the pinned Bun, `wasm-pack` and `wasm-opt` (binaryen) from `mise.toml`, and rustup, which installs the Rust toolchain from `rust-toolchain.toml`. `make setup` installs both when missing, then the locked dependencies and the Playwright Chromium:

```bash
make setup
make build
```

On macOS, if Rust build scripts fail to link with `tapi error: malformed file ... libSystem.B.tbd`, the Command Line Tools linker is older than the newest SDK. Copy `.env.example` to `.env` and set `SDKROOT` to an older SDK under `/Library/Developer/CommandLineTools/SDKs/`.

What happens during build, for each of the two crates:

1. `wasm-pack` builds the crate for `wasm32-unknown-unknown`.
2. `wasm-opt -O3` optimizes the binary.
3. The binary is written as a base64 module next to the wasm-bindgen glue.
4. `bun build` bundles `src/compressor.ts` or `src/decompressor.ts` with the glue and the base64 module into `dist/`.

`tsc` then generates the declaration files.

## Test and Benchmark

```bash
make test       # Rust unit tests, then Vitest in Node and in headless Chromium
make coverage   # Rust line coverage (fails below 60 %), then the TypeScript coverage table
make e2e        # packs the tarball into clean projects: Node.js, Bun, a bun build app and a Vite app (build + dev) in Chromium
make lint       # oxlint, tsc, clippy, rustfmt
make verify     # all of the above, as CI runs it
make bench      # Vitest bench and the 100 MB benchmark in Node, Bun and Chromium, against the perf budgets
bun run example # quality comparison table
```

`make e2e` writes one result file per consumer to `output/` (`e2e-node.json`, `e2e-bun.json`, `e2e-bun-bundle.json`, `e2e-vite-build.json`, `e2e-vite-dev.json`); `make e2e-runtime`, `make e2e-bun` and `make e2e-vite` run one group.

## License

MIT
