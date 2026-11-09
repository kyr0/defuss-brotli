// Runs a consumer app (e2e/web) in headless Chromium and round-trips input/page.html through its entry points.
// The app is a built directory served from http://e2e.test, or a Vite project on a throwaway `vite` dev server.
// --cdn <package-dir> also serves the installed package from a second origin with CORS, as jsDelivr does.
// Fails unless every expected .wasm was fetched with HTTP 200; --decompress-only also fails on any compressor fetch.
// usage: node browser.mjs <built-dir> | vite-dev:<project-dir>  <input-dir> <output-file>
//        [--page <file>] [--cdn <package-dir>] [--decompress-only]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { extname, join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { chromium } from "playwright";

const [app, inputDir, outputFile, ...flags] = process.argv.slice(2);
const option = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const page = option("--page") ?? "index.html";
const cdnDir = option("--cdn");
const decompressOnly = flags.includes("--decompress-only");
const APP = "http://e2e.test";
const CDN = "http://cdn.test/npm/defuss-brotli";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const log = (level, msg) => console.log(`${new Date().toISOString()} ${level} ${msg}`);

const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

async function startViteDev(projectDir) {
  const port = await freePort();
  const vite = resolve(projectDir, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 300 && child.exitCode === null; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return { url, stop: () => child.kill("SIGTERM") };
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`vite dev server did not answer on ${url}:\n${output}`);
}

// Serves `dir` under `origin` with the MIME types and CORS header a CDN sends.
const serve = (tab, origin, dir) =>
  tab.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(new URL(origin).pathname.length);
    try {
      route.fulfill({
        contentType: TYPES[extname(path)],
        headers: { "access-control-allow-origin": "*" },
        body: readFileSync(join(dir, path)),
      });
    } catch {
      route.fulfill({ status: 404 });
    }
  });

const text = readFileSync(join(inputDir, "page.html"), "utf8");
const packed = Array.from(brotliCompressSync(text));
const browser = await chromium.launch();
let server;
try {
  const tab = await browser.newPage();
  const errors = [];
  const fetched = [];
  tab.on("pageerror", (error) => errors.push(error));
  tab.on("response", (response) => fetched.push({ status: response.status(), url: response.url() }));
  let url;
  if (app.startsWith("vite-dev:")) {
    server = await startViteDev(app.slice("vite-dev:".length));
    url = server.url;
  } else {
    await serve(tab, APP, app);
    url = `${APP}/${page}`;
  }
  if (cdnDir) await serve(tab, CDN, cdnDir);
  await tab.goto(url);
  await tab.waitForFunction(() => typeof globalThis.runE2e === "function", null, { timeout: 30_000 });
  const report = await tab.evaluate(([t, p]) => globalThis.runE2e(t, p), [text, packed]);
  if (errors.length) throw errors[0];

  const pathOf = (f) => new URL(f.url).pathname;
  for (const name of decompressOnly ? ["decompressor"] : ["compressor", "decompressor"]) {
    const hit = fetched.find((f) => new RegExp(`/${name}[^/]*\\.wasm$`).test(pathOf(f)));
    if (!hit || hit.status !== 200) throw new Error(`no successful ${name} .wasm fetch; fetched ${JSON.stringify(fetched)}`);
  }
  const encoder = fetched.filter((f) => /\/compressor[^/]*\.(js|wasm)$/.test(pathOf(f)));
  if (decompressOnly && encoder.length) throw new Error(`decompress-only app fetched encoder files: ${JSON.stringify(encoder)}`);
  if (cdnDir && !fetched.some((f) => f.url.startsWith(CDN) && f.status === 200)) throw new Error("nothing was loaded from the CDN origin");

  const wasm = fetched.filter((f) => pathOf(f).endsWith(".wasm"));
  writeFileSync(outputFile, `${JSON.stringify({ app, page, ...report, wasm }, null, 2)}\n`);
  log("INFO", `e2e.browser passed bundler="${report.bundler}" app=${app} page=${page} cases=${report.results.length} output=${outputFile}`);
} finally {
  await browser.close();
  server?.stop();
}
