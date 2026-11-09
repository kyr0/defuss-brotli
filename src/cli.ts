// The `defuss-brotli` command behind `bunx defuss-brotli` / `npx defuss-brotli`. src/bin.ts wires it to the process;
// tests run it in-process on temporary directories and stream pairs. Each input is read whole and each output written
// at once through the public API rather than streamed between file descriptors and WASM memory: one code path with
// the library, at the cost that files must fit in memory (ARCH.md, "A command line that copies brotli's interface").
// VERIFIED: at quality 11 it compresses a 2.1 MB PNG in 1.99 s against 3.89 s for brotli 1.2.0 and a 5.1 MB SVG in
// 4.10 s against 4.12 s (Node.js, median of 5, README.md).
import { chmod, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { autoLgwin, HELP, parseCli, UsageError, type CliOptions } from "./cli-args.js";
import * as compressor from "./compressor-slim.js";
import * as decompressor from "./decompressor-slim.js";
import type { WasmSource } from "./wasm.js";

export interface CliEnv {
  stdin: Readable & { isTTY?: boolean };
  stdout: Writable & { isTTY?: boolean };
  stderr: Writable;
  version: string;
  /** Where each `.wasm` comes from; called once, and only for a mode the command line uses. */
  wasm: { compressor: () => WasmSource; decompressor: () => WasmSource };
}

// wasm32 `usize` caps any output at 2**32 - 1 bytes; the brotli CLI has no output limit either.
const NO_OUTPUT_LIMIT = 2 ** 32 - 1;

/** brotli's size format: `764 B`, `28.491 KiB`, `1.500 MiB`. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const [value, unit] = n < 1024 ** 2 ? [n / 1024, "KiB"] : n < 1024 ** 3 ? [n / 1024 ** 2, "MiB"] : [n / 1024 ** 3, "GiB"];
  return `${value.toFixed(3)} ${unit}`;
}

function write(stream: Writable, data: Uint8Array | string): Promise<void> {
  return new Promise((done, fail) => stream.write(data, (error) => (error ? fail(error) : done())));
}

async function readAll(stream: Readable): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // VERIFIED: Node.js 26 and Bun 1.4 both format fs errors as "ENOENT: no such file or directory, open 'name'";
  // the line already names the file, so only the description is kept.
  return /^[A-Z]+: (.+?), \w+ '.*'$/.exec(text)?.[1] ?? text;
}

/** Thrown with the line to print when one input fails; later inputs are not processed, as with brotli. */
class InputError extends Error {}

/** `undefined` writes to standard output. */
function outputPath(file: string, options: CliOptions): string | undefined {
  if (options.stdout || (file === "-" && options.output === undefined)) return undefined;
  if (options.output !== undefined) return options.output;
  if (options.mode === "compress") return file + options.suffix;
  if (!file.endsWith(options.suffix) || basename(file) === options.suffix) {
    throw new InputError(`input file [${file}] suffix mismatch`);
  }
  return file.slice(0, -options.suffix.length);
}

async function processFile(file: string, options: CliOptions, env: CliEnv): Promise<void> {
  const name = file === "-" ? "stdin" : file;
  const target = options.mode === "test" ? null : outputPath(file, options);
  if (target && file !== "-" && resolve(target) === resolve(file)) {
    throw new InputError(`input and output are the same file [${file}]`);
  }

  let input: Uint8Array;
  let source: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    input = file === "-" ? await readAll(env.stdin) : await readFile(file);
    source = file === "-" ? undefined : await stat(file);
  } catch (error) {
    throw new InputError(`failed to open input file [${name}]: ${message(error)}`);
  }

  const started = performance.now();
  let output: Uint8Array;
  if (options.mode === "compress") {
    if (!compressor.isReady()) await compressor.init(env.wasm.compressor());
    const lgwin = options.lgwin || autoLgwin(input.length);
    output = await compressor.compressParallel(input, { quality: options.quality, lgwin, threads: options.threads });
  } else {
    if (!decompressor.isReady()) await decompressor.init(env.wasm.decompressor());
    try {
      output = decompressor.decompress(input, { maxOutputSize: NO_OUTPUT_LIMIT });
    } catch (error) {
      throw new InputError(`corrupt input [${name}]: ${message(error)}`);
    }
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(2);

  // brotli 1.2 squashes only compressed output and then keeps the source, even with -j.
  const squashed = options.mode === "compress" && options.squash && !!target && output.length > input.length;
  if (target === undefined) {
    await write(env.stdout, output);
  } else if (target && !squashed) {
    try {
      await writeFile(target, output, { flag: options.force ? "w" : "wx" });
    } catch (error) {
      throw new InputError(`failed to open output file [${target}]: ${message(error)}`);
    }
    if (options.copyStat && source) {
      await chmod(target, source.mode & 0o7777);
      // Seconds as numbers keep the sub-millisecond part that Date objects would drop.
      await utimes(target, source.atimeMs / 1000, source.mtimeMs / 1000);
    }
  }
  if (options.verbose) {
    const verb = options.mode === "compress" ? "Compressed" : "Decompressed";
    env.stderr.write(`${verb} [${name}]: ${bytes(input.length)} -> ${bytes(output.length)} in ${seconds} sec\n`);
  }
  if (options.remove && file !== "-" && !squashed) await unlink(file);
}

/**
 * Runs one command line (the arguments after the program name) and resolves to the exit code: 0 on success, 1 on
 * a usage error or the first input that fails, like `brotli`. Messages go to `env.stderr`, never to `env.stdout`.
 */
export async function run(argv: string[], env: CliEnv): Promise<number> {
  let options: CliOptions;
  try {
    const command = parseCli(argv);
    if (command.kind === "help") return await write(env.stdout, HELP).then(() => 0);
    if (command.kind === "version") return await write(env.stdout, `defuss-brotli ${env.version}\n`).then(() => 0);
    options = command.options;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    env.stderr.write(`${error.message}\nUse -h for help.\n`);
    return 1;
  }

  // Same guards, order and wording as brotli 1.2: compressed bytes would garble a terminal, and a terminal on stdin
  // is usually a forgotten file name. Decompressed output may go to a terminal.
  const toStdout = options.stdout || (options.files.includes("-") && options.output === undefined);
  if (!options.force && options.mode === "compress" && toStdout && env.stdout.isTTY) {
    env.stderr.write("Use -h help. Use -f to force output to a terminal.\n");
    return 1;
  }
  if (!options.force && options.files.includes("-") && env.stdin.isTTY) {
    env.stderr.write("Use -h help. Use -f to force input from a terminal.\n");
    return 1;
  }

  for (const file of options.files) {
    try {
      await processFile(file, options, env);
    } catch (error) {
      // A reader that stops early (`| head`) is not an error worth a message; the exit code still says "incomplete".
      // VERIFIED: before this check, `-dc big.br | head -c 10` printed "write EPIPE" (Node.js) or "EPIPE: broken pipe".
      if ((error as { code?: string }).code !== "EPIPE") {
        env.stderr.write(`${error instanceof InputError ? error.message : `failed on [${file}]: ${message(error)}`}\n`);
      }
      return 1;
    }
  }
  return 0;
}
