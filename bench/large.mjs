// Large-payload benchmark of the built dist/: module load + init() per import, decompression of a 100 MiB text and
// of a 100 MB Brotli file, compression of the 100 MiB text, each against node:zlib's native Brotli where one exists.
// Inputs are generated deterministically and cached in tmp/bench/. Run with Node.js or Bun:
//   node bench/large.mjs [--chromium] [--check] [--json <file>] [--markdown]
// --check fails when a median exceeds bench/perf-budgets.json for this runtime.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

const ROOT = new URL("../", import.meta.url);
const DIST = new URL("dist/", ROOT);
const CACHE = new URL("tmp/bench/", ROOT);
const MiB = 2 ** 20;
const MAX_OUTPUT = 128 * MiB;
const RUNS = 5;
const args = process.argv.slice(2);
mkdirSync(CACHE, { recursive: true });
const log = (level, msg) => console.log(`${new Date().toISOString()} ${level} ${msg}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

// 100 MiB of JSON log lines from a fixed xorshift seed: realistic redundancy, identical on every machine.
function generateText() {
  let x = 0x2545f491;
  const rand = (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
  const words = ["user", "order", "cart", "item", "price", "stock", "token", "session", "query", "cache", "retry", "shipment"];
  const levels = ["info", "info", "info", "debug", "warn", "error"];
  const out = Buffer.alloc(100 * MiB);
  let at = 0;
  for (let i = 0; at < out.length; i++) {
    const line = JSON.stringify({
      ts: new Date(Date.UTC(2026, 0, 1) + i * 137).toISOString(),
      level: levels[rand(levels.length)],
      path: `/api/${words[rand(words.length)]}/${rand(100000)}`,
      user: rand(50000),
      ms: rand(200000) / 100,
      msg: `${words[rand(words.length)]} ${words[rand(words.length)]} ${rand(10) < 3 ? "failed" : "ok"}`,
    }) + "\n";
    at += out.write(line, at);
  }
  return out;
}

function dataset(name, make, quality) {
  const file = new URL(`${name}.br`, CACHE);
  const meta = new URL(`${name}.json`, CACHE);
  if (!existsSync(file) || !existsSync(meta)) {
    const plain = make();
    log("INFO", `bench.prepare dataset=${name} bytes=${plain.length} quality=${quality} (one-time, cached in tmp/bench)`);
    const packed = brotliCompressSync(plain, {
      params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: plain.length },
    });
    writeFileSync(file, packed);
    writeFileSync(meta, JSON.stringify({ bytes: plain.length, sha256: sha256(plain), quality }));
  }
  return { name, packed: new Uint8Array(readFileSync(file)), ...JSON.parse(readFileSync(meta, "utf8")) };
}

let x = 0x9e3779b9;
const random = () => {
  const b = Buffer.alloc(100 * 1000 * 1000);
  for (let i = 0; i < b.length; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    b.writeUInt32LE(x >>> 0, i);
  }
  return b;
};

// Each import gets a fresh module instance from a copy of its dist file, so load + init is measured cold.
let copies = 0;
async function freshImport(file) {
  const copy = new URL(`fresh-${copies++}-${file}`, CACHE);
  copyFileSync(new URL(file, DIST), copy);
  for (const wasm of ["compressor.wasm", "decompressor.wasm"]) copyFileSync(new URL(wasm, DIST), new URL(wasm, CACHE));
  return import(copy.href);
}

// The harness, not the package, reads WASM memory: it wraps instantiate to keep the instance's memory.
let lastMemory;
for (const name of ["instantiate", "instantiateStreaming"]) {
  const original = WebAssembly[name];
  WebAssembly[name] = async (...a) => {
    const result = await original.apply(WebAssembly, a);
    lastMemory = (result.instance ?? result).exports.memory;
    return result;
  };
}

async function measureRuntime(runtime) {
  const results = {};
  for (const file of ["decompressor.js", "decompressor-slim.js", "compressor.js", "compressor-slim.js"]) {
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      const m = await freshImport(file);
      await m.init();
      times.push(performance.now() - t);
    }
    results[`init:${file.replace(".js", "")}`] = median(times);
  }

  const d = await freshImport("decompressor-slim.js");
  await d.init();
  for (const ds of [dataset("text-100mib", generateText, 11), dataset("binary-100mb", random, 5)]) {
    // Cold: the first call on a fresh instance pays for growing and paging in WASM memory, as one-off decodes do.
    const cold = await freshImport("decompressor-slim.js");
    await cold.init();
    let t = performance.now();
    cold.decompress(ds.packed, { maxOutputSize: MAX_OUTPUT });
    results[`decompress-cold:${ds.name}`] = performance.now() - t;
    results[`wasm-memory-mib:${ds.name}`] = lastMemory.buffer.byteLength / MiB;
    const out = d.decompress(ds.packed, { maxOutputSize: MAX_OUTPUT });
    if (out.length !== ds.bytes || sha256(out) !== ds.sha256) throw new Error(`${ds.name}: wrong output`);
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      t = performance.now();
      d.decompress(ds.packed, { maxOutputSize: MAX_OUTPUT });
      times.push(performance.now() - t);
    }
    const native = [];
    for (let i = 0; i < RUNS; i++) {
      t = performance.now();
      brotliDecompressSync(ds.packed);
      native.push(performance.now() - t);
    }
    results[`decompress:${ds.name}`] = median(times);
    results[`native-decompress:${ds.name}`] = median(native);
    results[`input-bytes:${ds.name}`] = ds.packed.length;
  }

  const c = await freshImport("compressor-slim.js");
  await c.init();
  const text = brotliDecompressSync(dataset("text-100mib", generateText, 11).packed);
  const times = [];
  const native = [];
  for (let i = 0; i < 3; i++) {
    let t = performance.now();
    const packed = c.compress(text, { quality: 6 });
    times.push(performance.now() - t);
    t = performance.now();
    brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
    native.push(performance.now() - t);
    results["output-bytes:compress-q6"] = packed.length;
  }
  results["compress-q6:text-100mib"] = median(times);
  results["wasm-memory-mib:compress-q6"] = lastMemory.buffer.byteLength / MiB;
  results["native-compress-q6:text-100mib"] = median(native);
  return { runtime, results };
}

async function measureChromium() {
  const { chromium } = await import("playwright");
  const text = dataset("text-100mib", generateText, 11);
  const binary = dataset("binary-100mb", random, 5);
  // A real HTTP server: Playwright's route.fulfill cannot carry 100 MB bodies.
  const { createServer } = await import("node:http");
  const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".br": "application/octet-stream" };
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      const file = path === "/" ? null : path.startsWith("/data/") ? new URL(path.slice(6), CACHE) : new URL(path.slice(1), DIST);
      res.writeHead(200, { "Content-Type": types[path.slice(path.lastIndexOf("."))] ?? "text/html" });
      res.end(file ? readFileSync(file) : "<!doctype html>");
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("crash", () => log("ERROR", "bench.chromium page crashed"));
    page.on("pageerror", (e) => log("ERROR", `bench.chromium pageerror: ${e.message}`));
    await page.goto(`${origin}/`);
    const results = await page.evaluate(async ({ runs, max, datasets }) => {
      const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
      let lastMemory;
      for (const name of ["instantiate", "instantiateStreaming"]) {
        const original = WebAssembly[name];
        WebAssembly[name] = async (...a) => {
          const result = await original.apply(WebAssembly, a);
          lastMemory = (result.instance ?? result).exports.memory;
          return result;
        };
      }
      const out = {};
      for (const file of ["decompressor.js", "decompressor-slim.js", "compressor.js", "compressor-slim.js"]) {
        const times = [];
        for (let i = 0; i < runs; i++) {
          const t = performance.now();
          const m = await import(`/${file}?fresh=${i}`);
          await m.init();
          times.push(performance.now() - t);
        }
        out[`init:${file.replace(".js", "")}`] = median(times);
      }
      const d = await import("/decompressor-slim.js?bench");
      await d.init(new URL("/decompressor.wasm", location.href));
      for (const ds of datasets) {
        const packed = new Uint8Array(await (await fetch(`/data/${ds.name}.br`)).arrayBuffer());
        const cold = await import(`/decompressor-slim.js?cold-${ds.name}`);
        await cold.init();
        let t = performance.now();
        cold.decompress(packed, { maxOutputSize: max });
        out[`decompress-cold:${ds.name}`] = performance.now() - t;
        out[`wasm-memory-mib:${ds.name}`] = lastMemory.buffer.byteLength / 2 ** 20;
        if (d.decompress(packed, { maxOutputSize: max }).length !== ds.bytes) throw new Error(`${ds.name}: wrong length`);
        const times = [];
        for (let i = 0; i < runs; i++) {
          t = performance.now();
          d.decompress(packed, { maxOutputSize: max });
          times.push(performance.now() - t);
        }
        out[`decompress:${ds.name}`] = median(times);
        out[`input-bytes:${ds.name}`] = packed.length;
      }
      return out;
    }, { runs: RUNS, max: MAX_OUTPUT, datasets: [text, binary].map(({ name, bytes }) => ({ name, bytes })) });
    return { runtime: `chromium ${browser.version()}`, results };
  } finally {
    await browser.close();
    server.close();
  }
}

const reports = [await measureRuntime(globalThis.Bun ? `bun ${globalThis.Bun.version}` : `node ${process.version}`)];
if (args.includes("--chromium")) reports.push(await measureChromium());

const budgets = JSON.parse(readFileSync(new URL("bench/perf-budgets.json", ROOT), "utf8"));
const failures = [];
for (const { runtime, results } of reports) {
  const budget = budgets.runtimes[runtime.split(" ")[0]] ?? {};
  for (const [key, value] of Object.entries(results)) {
    log("INFO", `bench runtime="${runtime}" ${key}=${Number(value.toFixed(2))}${budget[key] ? ` budget=${budget[key]}` : ""}`);
    if (budget[key] && value > budget[key]) failures.push(`${runtime} ${key}: ${value.toFixed(1)} > budget ${budget[key]}`);
  }
}
const jsonAt = args.indexOf("--json");
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], `${JSON.stringify(reports, null, 2)}\n`);
for (const failure of failures) console.error(`${new Date().toISOString()} ERROR perf budget exceeded: ${failure}`);
if (args.includes("--check") && failures.length) process.exit(1);
