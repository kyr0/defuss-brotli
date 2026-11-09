// Measures the numbers behind the website's performance charts and writes site/data/bench.json.
// usage: node site/measure.mjs   (after `make build`)
// VERIFIED: a run without the 100 MiB input took 2.5 minutes on an Apple M5 Max (2026-11-09, var/log/measure.log).
// One process, one WASM build (MEMORY: several builds in one process skew timings); each timing is the median of
// RUNS calls after one warm-up call, so the charts show warm throughput, not instantiation. The 100 MiB input gets
// one call per point at quality 10 and 11, which take minutes on one core; below them it gets the warm-up too, which
// matters: VERIFIED (2026-11-09) single calls without it measured compress at quality 8 at 8.6 s and the same code
// through compressParallel right after at 5.1 s.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { MIN_PART_SIZE, PARALLEL_PARTS, compress, compressParallel, init } from "../dist/compressor.js";
import { logLines } from "./lib/logs.ts";

const root = new URL("..", import.meta.url);
const read = (path) => new Uint8Array(readFileSync(new URL(path, root)));
const svg = read("huge.svg");
const INPUTS = {
  html: { label: "HTML page", file: "input/page.html", bytes: read("input/page.html") },
  json: { label: "JSON", file: "input/data.json", bytes: read("input/data.json") },
  svg: { label: "SVG drawing, first 1 MiB", file: "huge.svg", bytes: svg.slice(0, 1024 * 1024) },
  png: { label: "PNG image", file: "huge.png", bytes: read("huge.png") },
  // The demo's log lines (site/lib/logs.ts), 100 MiB of them: where compressParallel keeps more than 8 cores busy.
  logs: { label: "Log lines, 100 MiB", file: "site/lib/logs.ts", bytes: logLines(100 * 2 ** 20), slowRuns: 1 },
};
const RUNS = 3;
const log = (message) => console.log(`${new Date().toISOString()} INFO ${message}`);

async function timed(fn, runs = RUNS) {
  let output = runs > 1 ? await fn() : undefined;
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    output = await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { size: output.length, ms: Math.round(times[runs >> 1] * 100) / 100 };
}

// How many cores compressParallel keeps busy: one per part, at most `threads`. The part rule of partRanges in
// src/compressor-core.ts at window 22: 8 parts, or parts of two windows when those are shorter.
const cores = (length, threads) => {
  const size = Math.max(Math.min(Math.ceil(length / PARALLEL_PARTS), 2 * 2 ** 22), MIN_PART_SIZE);
  return Math.min(threads, length <= size ? 1 : Math.ceil(length / size));
};

const native = (bytes, quality, lgwin = 22) =>
  brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_LGWIN]: lgwin,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });

await init();
const result = {
  measured: new Date().toISOString().slice(0, 10),
  node: process.version,
  cpu: cpus()[0]?.model ?? "unknown",
  threads: availableParallelism(),
  inputs: {},
  quality: {},
  gzip: {},
  window: {},
};
for (const [key, { label, file, bytes, slowRuns = RUNS }] of Object.entries(INPUTS)) {
  result.inputs[key] = { label, file, bytes: bytes.length, runs: slowRuns, cores: cores(bytes.length, result.threads) };
  result.gzip[key] = await timed(() => gzipSync(bytes, { level: 9 }));
  result.quality[key] = [];
  for (let quality = 0; quality <= 11; quality++) {
    const n = quality >= 10 ? slowRuns : RUNS;
    const single = await timed(() => compress(bytes, { quality }), n);
    const parallel = await timed(() => compressParallel(bytes, { quality }), n);
    const reference = await timed(() => native(bytes, quality), n);
    result.quality[key].push({ quality, ...single, parallel, native: reference });
    log(`input=${key} quality=${quality} size=${single.size} ms=${single.ms} parallel_ms=${parallel.ms} native_ms=${reference.ms}`);
  }
}
for (const key of ["svg", "png"]) {
  const { bytes } = INPUTS[key];
  result.window[key] = [];
  for (const lgwin of [16, 18, 20, 22, 24]) {
    const single = await timed(() => compress(bytes, { quality: 11, lgwin }));
    result.window[key].push({ lgwin, ...single });
    log(`input=${key} lgwin=${lgwin} size=${single.size} ms=${single.ms}`);
  }
}
// The download size of each import, from the same script that checks the size budgets.
mkdirSync(new URL("data/", import.meta.url), { recursive: true });
const sizesFile = new URL("data/sizes.json", import.meta.url);
execFileSync(process.execPath, [new URL("scripts/sizes.mjs", root).pathname, ".", "--json", sizesFile.pathname], {
  cwd: root.pathname,
  stdio: "inherit",
});
result.sizes = JSON.parse(readFileSync(sizesFile, "utf8")).report.map(({ variant, total }) => ({ variant, ...total }));
writeFileSync(new URL("data/bench.json", import.meta.url), `${JSON.stringify(result, null, 1)}\n`);
log("wrote site/data/bench.json");
