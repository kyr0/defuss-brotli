// The worker side of a parallel compression (src/workers.ts). The build bundles this file with the glue into one
// classic script and embeds it as a string (wasm/pkg/compressor/worker_source.js); it runs as a Web Worker
// (browsers, Bun) or as a Node.js `worker_threads` worker started with `eval`. VERIFIED: instantiating the posted
// module takes 0.2 ms (Node.js 26) to 0.5 ms (Bun 1.4), so a worker per call costs little next to compression.
import * as glue from "../wasm/pkg/compressor/defuss_brotli_compressor_bg.js";
import { encodeWith } from "./compressor-encode.js";
import { instantiateWasm } from "./wasm.js";
import type { WorkerReply, WorkerRequest } from "./workers.js";

interface ReplyPort {
  postMessage(reply: WorkerReply, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as {
  self?: ReplyPort & { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
  process?: { getBuiltinModule(id: string): { parentPort: ReplyPort & { on(e: "message", f: (r: WorkerRequest) => void): void } } };
};
const nodePort = scope.self ? undefined : scope.process!.getBuiltinModule("node:worker_threads").parentPort;
const port: ReplyPort = scope.self ?? nodePort!;
let memory: Promise<WebAssembly.Memory> | undefined;

async function handle(request: WorkerRequest): Promise<void> {
  if ("module" in request) {
    memory = instantiateWasm(request.module, "./defuss_brotli_compressor_bg.js", glue).then((wasm) => wasm.memory);
    return;
  }
  try {
    const { part, total, quality, lgwin, dictionary } = request;
    const wasm = await memory!;
    const output = encodeWith(wasm, glue.Encoder.part(part.length, total, quality, lgwin, dictionary), part);
    port.postMessage({ id: request.id, output }, [output.buffer]);
  } catch (error) {
    port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
}

if (nodePort) nodePort.on("message", (request) => void handle(request));
else scope.self!.onmessage = (event) => void handle(event.data);
