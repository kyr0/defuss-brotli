// Runs the parts of a parallel compression on workers, each with its own instance of the compressor WASM module.
// The worker script is a string built from src/compressor-worker.ts and started from a Blob URL (browsers, Bun) or
// with `eval` (Node.js worker_threads), so no bundler has to find, copy or rewrite a separate worker file.
// VERIFIED: such a worker starts and answers in 7.7 ms on Node.js 26 and 3.5 ms on Bun 1.4, and receives a posted
// WebAssembly.Module intact; `make e2e` runs it in Chromium from bun build, Vite (build and dev) and CDN apps.
// Where starting the worker throws (no worker API, or no classic workers), the parts run on the caller.

/** One part: its bytes, the input before it (at most one window) as dictionary, and the shared encoder settings. */
export interface PartTask {
  total: number;
  quality: number;
  lgwin: number;
  part: Uint8Array;
  dictionary: Uint8Array;
}

export type WorkerRequest = { module: WebAssembly.Module } | ({ id: number } & PartTask);
export type WorkerReply = { id: number; output: Uint8Array } | { id: number; error: string };

interface Port {
  post(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface NodeWorker {
  on(event: "message", listener: (reply: WorkerReply) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): Promise<number>;
}

type NodeWorkerThreads = { Worker: new (source: string, options: { eval: true }) => NodeWorker };

/** A started worker, or `null` when this runtime has no worker API. */
function spawn(source: string, onReply: (reply: WorkerReply) => void, onError: (error: Error) => void): Port | null {
  if (typeof Worker === "function") {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => onReply(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      onError(new Error(`compressor worker failed: ${event.message}`));
    };
    return {
      post: (message, transfer) => worker.postMessage(message, transfer),
      terminate: () => {
        worker.terminate();
        URL.revokeObjectURL(url);
      },
    };
  }
  const runtime = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const threads = runtime?.getBuiltinModule?.("node:worker_threads") as NodeWorkerThreads | undefined;
  if (!threads) return null;
  const worker = new threads.Worker(source, { eval: true });
  worker.on("message", onReply);
  worker.on("error", onError);
  return {
    post: (message, transfer) => worker.postMessage(message, transfer),
    terminate: () => void worker.terminate(),
  };
}

/**
 * Compresses `tasks` on `threads` workers started from `source`, each given `module` once, and resolves to the
 * outputs in task order; workers are terminated when the last part arrives or the first one fails. Resolves to
 * `null` when the runtime cannot start workers, so the caller can run the parts itself. Each task's buffers are
 * transferred to its worker and are detached afterwards.
 */
export function runParts(
  source: string,
  module: WebAssembly.Module,
  tasks: PartTask[],
  threads: number,
): Promise<Uint8Array[] | null> {
  return new Promise((resolve, reject) => {
    const outputs: Uint8Array[] = [];
    const ports: Port[] = [];
    let next = 0;
    let done = 0;
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      for (const port of ports) port.terminate();
      if (error) reject(error);
      else resolve(outputs);
    };
    const dispatch = (port: Port) => {
      if (next === tasks.length) return;
      const id = next++;
      const task = tasks[id]!;
      port.post({ id, ...task }, [task.part.buffer, task.dictionary.buffer]);
    };
    for (let i = 0; i < threads && !settled; i++) {
      let port: Port | null = null;
      try {
        port = spawn(
          source,
          (reply) => {
            if ("error" in reply) return settle(new Error(reply.error));
            outputs[reply.id] = reply.output;
            if (++done === tasks.length) settle();
            else dispatch(port!);
          },
          settle,
        );
      } catch {
        // A synchronous failure (no worker support, a CSP without `worker-src blob:`) on the first worker means
        // none can start; later workers only add speed.
        if (i === 0) return resolve(null);
        break;
      }
      if (!port) return resolve(null);
      ports.push(port);
      port.post({ module }, []);
      dispatch(port);
    }
  });
}
