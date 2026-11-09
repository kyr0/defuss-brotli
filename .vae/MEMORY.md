# Agent memory

<!-- One tagged line per durable fact NOT derivable from code, git or docs:
- VERIFIED[scope] fact BC evidence
- HYPOTHESIS[scope] claim BC observation; falsifier=`cmd`
- UNKNOWN[scope] gap BC missing evidence
[scope] = the narrowest path|module|command|condition the evidence covers, not a topic: the entry decides nothing
outside it, and recurrence inside one subsystem never widens it.
Every line carries its BC and stays within 240 chars. Replace stale lines instead of appending.
Mechanizable lessons belong in tests or .vae/VERIFY.py.
Budget 4 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[bench: several WASM builds in one process] later builds measure up to 2x slower (same artifact 0.094 vs 0.203 ms first vs last) BC 2026-11-08 harness; benchmark one build per process, interleaved rounds
- VERIFIED[wasm size: wasm-opt -Oz on compressor] raw shrinks but gzip grows (982,742→911,595 raw; 430,147→446,037 gz) BC 2026-11-08 measurement; judge size by transport-compressed bytes (`make metrics`)
- VERIFIED[macOS: CLT ld-1267 + MacOSX27.0.sdk] Rust build scripts fail "tapi error: malformed file" BC 2026-11-08 cargo build; SDKROOT=…/MacOSX26.sdk in .env fixes it
- VERIFIED[jsDelivr transfer encoding] brotli responses = quality 4 byte-exact, gzip ≈ level 6-9, no zstd, .wasm as application/wasm + CORS * BC 2026-11-09 curl of defuss-brotli@0.1.3 and esbuild-wasm; size budgets track br4
- VERIFIED[Bun 1.4 ESM imports] `import("file:...js?tag")` returns the cached instance (no cache-busting) BC e2e/runtime.mjs failure 2026-11-09; copy the file for a fresh instance
- VERIFIED[Playwright route.fulfill] 100 MB bodies close the page ("Target page ... closed") BC bench/large.mjs 2026-11-09; serve large files from node:http
- VERIFIED[GNU Make 3.81 macOS] edits in the same second as tmp/build.stamp skip `make build` (1 s mtimes) BC stale dist in a probe 2026-11-09; sleep 1 + touch, or make clean
- VERIFIED[vitest toEqual on large typed arrays] 32 MiB Uint8Array comparison exhausts the 4 GiB V8 heap BC src/memory.test.ts 2026-11-09; compare with Buffer.equals
- VERIFIED[brotli q11 of compressor.wasm] swings 340,693 ↔ 392,638 B under wasm-opt passes that move raw and br4 by 0.2 % BC 2026-11-09 measurement; judge size changes by br4/gzip, budget br11 at the upper value
- VERIFIED[bunx running a `#!/usr/bin/env node` bin] uses Node when it is on PATH, Bun when not, Bun with `--bun`; in a project that installed the package, bunx runs that local bin offline BC 2026-11-09 PATH-wrapper probe in tmp/e2e/cli
- VERIFIED[brotli 1.2.0 CLI defaults] quality 11 and the smallest lgwin with 2**w - 16 >= file size (stdin: 24); usage errors print the help to stdout BC md5 and exit-code probes 2026-11-09
- VERIFIED[Bun 1.4 exit after Worker.terminate()] the process lingers ~200 ms while terminated workers shut down; flush stdout/stderr, then process.exit BC src/bin.ts probe 2026-11-09 (300 → 85 ms)
- VERIFIED[Deno] not installed here; worker behavior there is UNKNOWN, docs make no Deno claim BC `which deno` 2026-11-09
