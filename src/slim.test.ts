import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { FIXTURE_TEXT, FIXTURE_TEXT_BROTLI } from "./fixtures";

const DECOMPRESSOR_WASM = new URL("../wasm/pkg/decompressor/defuss_brotli_decompressor_bg.wasm", import.meta.url);
const COMPRESSOR_WASM = new URL("../wasm/pkg/compressor/defuss_brotli_compressor_bg.wasm", import.meta.url);
const wasmBytes = () => new Uint8Array(readFileSync(DECOMPRESSOR_WASM));

// Each test needs a fresh, uninitialized entry point: init() is once per module instance.
const freshDecompressor = async () => {
  vi.resetModules();
  return import("./decompressor-slim");
};

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/decompressor.wasm") {
      res.writeHead(200, { "Content-Type": "application/wasm" }).end(wasmBytes());
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("decompressor/slim init(source)", () => {
  beforeEach(() => vi.resetModules());

  const sources: [string, () => unknown][] = [
    ["a file: URL", () => DECOMPRESSOR_WASM],
    ["a file: URL string", () => DECOMPRESSOR_WASM.href],
    ["bytes", () => wasmBytes()],
    ["an ArrayBuffer", () => wasmBytes().buffer],
    ["a compiled WebAssembly.Module", () => new WebAssembly.Module(wasmBytes())],
    ["an application/wasm Response", () => new Response(wasmBytes(), { headers: { "Content-Type": "application/wasm" } })],
    ["a Response with another MIME type", () => new Response(wasmBytes(), { headers: { "Content-Type": "application/octet-stream" } })],
    ["an http: URL", () => `${origin}/decompressor.wasm`],
    ["a fetch() promise", () => fetch(`${origin}/decompressor.wasm`)],
  ];

  test.each(sources)("loads from %s", async (_, source) => {
    const decompressor = await freshDecompressor();
    expect(decompressor.isReady()).toBe(false);
    await decompressor.init(source() as Parameters<typeof decompressor.init>[0]);
    expect(decompressor.decompressText(FIXTURE_TEXT_BROTLI)).toBe(FIXTURE_TEXT);
  });

  test("rejects with the HTTP status when the .wasm is missing, and a later init() retries", async () => {
    const decompressor = await freshDecompressor();
    await expect(decompressor.init(`${origin}/missing.wasm`)).rejects.toThrow("HTTP 404");
    expect(decompressor.isReady()).toBe(false);
    await decompressor.init(`${origin}/decompressor.wasm`);
    expect(decompressor.decompressText(FIXTURE_TEXT_BROTLI)).toBe(FIXTURE_TEXT);
  });

  test("rejects a relative path where no page URL exists to resolve it", async () => {
    const decompressor = await freshDecompressor();
    await expect(decompressor.init("decompressor.wasm")).rejects.toThrow();
  });

  test("is idempotent: a second call returns the first Promise", async () => {
    const decompressor = await freshDecompressor();
    const first = decompressor.init(DECOMPRESSOR_WASM);
    expect(decompressor.init(`${origin}/missing.wasm`)).toBe(first);
    await first;
    expect(decompressor.isReady()).toBe(true);
  });
});

describe("compressor/slim", () => {
  test("a failed load is forgotten, so the next init() retries", async () => {
    vi.resetModules();
    const compressor = await import("./compressor-slim");
    await expect(compressor.init(`${origin}/missing.wasm`)).rejects.toThrow("HTTP 404");
    await compressor.init(COMPRESSOR_WASM);
    expect(compressor.compress(new Uint8Array(8)).length).toBeGreaterThan(0);
  });

  test("round-trips through both slim entry points", async () => {
    vi.resetModules();
    const compressor = await import("./compressor-slim");
    const decompressor = await import("./decompressor-slim");
    await Promise.all([compressor.init(COMPRESSOR_WASM), decompressor.init(DECOMPRESSOR_WASM)]);
    const text = "slim ".repeat(1000);
    expect(decompressor.decompressText(compressor.compressText(text, { quality: 5 }))).toBe(text);
  });
});
