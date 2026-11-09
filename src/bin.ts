#!/usr/bin/env node
// The `defuss-brotli` executable (package.json "bin"): src/cli.ts on the real process. Built to dist/cli.js, which
// sits next to dist/*.wasm and below package.json. Only process wiring lives here, so `make e2e` covers it.
import { readFileSync } from "node:fs";
import { run } from "./cli.js";

const local = (path: string) => new URL(path, import.meta.url);
const { version } = JSON.parse(readFileSync(local("../package.json"), "utf8")) as { version: string };

// Write failures reach run() through the write callbacks. VERIFIED: without this listener, Node.js 26 also emits the
// EPIPE of `defuss-brotli -dc big.br | head` as an unhandled 'error' event and crashes with a stack trace; Bun 1.4 does not.
process.stdout.on("error", () => {});
const code = await run(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  version,
  // Bytes rather than file: URLs: the slim init() reads file: URLs through process.getBuiltinModule (Node.js 20.16+
  // and 22.3+), which the package's engines (^20.0.0) do not guarantee.
  wasm: {
    compressor: () => readFileSync(local("./compressor.wasm")),
    decompressor: () => readFileSync(local("./decompressor.wasm")),
  },
});

// Exit as soon as both streams are flushed (a write callback runs after the writes queued before it). VERIFIED:
// Bun 1.4 otherwise waits for the terminated compressParallel workers to shut down, 300 ms instead of 85 ms for a
// 256 KiB file; Node.js 26 exits as fast either way.
const flushed = (stream: NodeJS.WriteStream) => new Promise((done) => stream.write("", done));
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
