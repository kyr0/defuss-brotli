/** The wasm-bindgen `bundler` glue (`*_bg.js`): every import the WASM module needs, plus its setter. */
export interface WasmGlue {
  __wbg_set_wasm(exports: WebAssembly.Exports): void;
}

/**
 * Where a `/slim` entry point gets its `.wasm` binary from.
 *
 * - `URL` or `string`: fetched (`http:`, `https:`, `data:`, relative paths in browsers) or, for `file:` URLs, read
 *   with `node:fs` in runtimes that provide `process.getBuiltinModule` (Node.js 20.16+ and 22.3+, Bun).
 * - `Response` or a promise of one, e.g. `fetch(url)`: compiled while it streams when served as `application/wasm`.
 * - Bytes (`ArrayBuffer` or a typed array) or an already compiled `WebAssembly.Module`.
 */
export type WasmSource =
  | string
  | URL
  | Response
  | PromiseLike<Response>
  | ArrayBuffer
  | ArrayBufferView<ArrayBuffer>
  | WebAssembly.Module;

type NodeFs = { readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> };

export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// `process.getBuiltinModule` instead of `import("node:fs/promises")`: bundlers resolve import specifiers for browser
// builds and some reject `node:` ones, while a property lookup is invisible to them.
async function readFileUrl(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  const runtime = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const fs = runtime?.getBuiltinModule?.("node:fs/promises") as NodeFs | undefined;
  if (!fs) {
    throw new Error(`cannot read ${url.href} in this runtime; pass the .wasm bytes or a Response to init() instead`);
  }
  return fs.readFile(url);
}

async function instantiateResponse(response: Response, imports: WebAssembly.Imports): Promise<WebAssembly.Instance> {
  if (!response.ok) throw new Error(`failed to load WASM from ${response.url}: HTTP ${response.status}`);
  // instantiateStreaming rejects any other MIME type, so other servers fall back to buffering the body.
  if (typeof WebAssembly.instantiateStreaming === "function" && response.headers.get("Content-Type") === "application/wasm") {
    return (await WebAssembly.instantiateStreaming(response, imports)).instance;
  }
  return (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance;
}

/**
 * Instantiates a WASM module from `source` against its wasm-bindgen glue, hands the exports to the glue and
 * returns the instance's linear memory, from which the entry points copy chunks directly.
 *
 * VERIFIED: the whole glue namespace is the import object, so hashed wasm-bindgen shim names need no build change
 * when a release or a Rust signature renames them.
 */
export async function instantiateWasm(
  source: WasmSource,
  glueModule: string,
  glue: WasmGlue,
): Promise<WebAssembly.Memory> {
  const imports = { [glueModule]: glue as unknown as WebAssembly.ModuleImports };
  let resolved = await source;
  if (typeof resolved === "string" || resolved instanceof URL) {
    const url = new URL(resolved, globalThis.location?.href);
    resolved = url.protocol === "file:" ? await readFileUrl(url) : await fetch(url);
  }
  let instance: WebAssembly.Instance;
  if (resolved instanceof WebAssembly.Module) instance = await WebAssembly.instantiate(resolved, imports);
  else if (resolved instanceof Response) instance = await instantiateResponse(resolved, imports);
  else instance = (await WebAssembly.instantiate(resolved, imports)).instance;
  glue.__wbg_set_wasm(instance.exports);
  return instance.exports.memory as WebAssembly.Memory;
}

/** Joins chunks copied out of WASM memory; a single chunk is returned as is. */
export function concat(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
