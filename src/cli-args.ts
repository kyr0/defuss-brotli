// Argument parsing for the `defuss-brotli` command, kept free of I/O, so that scripts can swap it for `brotli`.
// VERIFIED: `brotli` 1.2.0 (2026-11-09) uses quality 11, a window chosen from the input size, the `.br` suffix, keeps
// sources, and takes coalesced short flags (`-9kf`), `-` for standard input and `--` before file names. node:util parseArgs over a
// hand-written parser: Node.js and Bun both ship it, and its tokens keep the order that makes the last option win.
import { parseArgs } from "node:util";

export type Mode = "compress" | "decompress" | "test";

export interface CliOptions {
  mode: Mode;
  /** Input paths; `-` is standard input. */
  files: string[];
  stdout: boolean;
  output: string | undefined;
  force: boolean;
  /** `-j`: delete each source after its output is written. */
  remove: boolean;
  squash: boolean;
  copyStat: boolean;
  verbose: boolean;
  quality: number;
  /** 0 picks the smallest window that holds the whole input, as brotli does. */
  lgwin: number;
  suffix: string;
  /** Workers for compressParallel; `undefined` uses its default. */
  threads: number | undefined;
}

export type CliCommand = { kind: "help" } | { kind: "version" } | { kind: "run"; options: CliOptions };

/** A command line the CLI rejects before touching any file. */
export class UsageError extends Error {}

export const HELP = `Usage: defuss-brotli [compress|decompress] [OPTION]... [FILE]...
Compress (default) or decompress FILEs with Brotli; the options follow the brotli CLI.
Options:
  -#                          compression level (0-9)
  -c, --stdout                write on standard output
  -d, --decompress            decompress (same as the decompress command)
  -f, --force                 force output file overwrite and terminal input/output
  -h, --help                  display this help and exit
  -j, --rm                    remove source file(s)
  -s, --squash                remove destination file if larger than source
  -k, --keep                  keep source file(s) (default)
  -n, --no-copy-stat          do not copy source file(s) mode and timestamps
  -o FILE, --output=FILE      output file (only if 1 input file)
  -q NUM, --quality=NUM       compression level (0-11)
  -t, --test                  test compressed file integrity
  -v, --verbose               verbose mode
  -w NUM, --lgwin=NUM         set LZ77 window size (0, 10-24)
                              window size = 2**NUM - 16
                              0 lets compressor choose the optimal value
  -S SUF, --suffix=SUF        output file suffix (default:'.br')
  --threads=NUM               compress on up to NUM workers (default: CPUs, at most 8);
                              the output is the same for every NUM
  -V, --version               display version and exit
  -Z, --best                  use best compression level (11) (default)
Simple options could be coalesced, i.e. '-9kf' is equivalent to '-9 -k -f'.
With no FILE, or when FILE is -, read standard input.
All arguments after '--' are treated as files.
Not supported: --large_window, -C/--comment, -D/--dictionary, -K/--concatenated.
`;

const LEVELS = Object.fromEntries(
  Array.from({ length: 10 }, (_, level) => [String(level), { type: "boolean", short: String(level) }] as const),
);

const OPTIONS = {
  ...LEVELS,
  stdout: { type: "boolean", short: "c" },
  decompress: { type: "boolean", short: "d" },
  force: { type: "boolean", short: "f" },
  help: { type: "boolean", short: "h" },
  rm: { type: "boolean", short: "j" },
  squash: { type: "boolean", short: "s" },
  keep: { type: "boolean", short: "k" },
  "no-copy-stat": { type: "boolean", short: "n" },
  output: { type: "string", short: "o" },
  quality: { type: "string", short: "q" },
  test: { type: "boolean", short: "t" },
  verbose: { type: "boolean", short: "v" },
  lgwin: { type: "string", short: "w" },
  suffix: { type: "string", short: "S" },
  version: { type: "boolean", short: "V" },
  best: { type: "boolean", short: "Z" },
  threads: { type: "string" },
  // Recognized so that they fail with a reason instead of "unknown option".
  large_window: { type: "string" },
  comment: { type: "string", short: "C" },
  dictionary: { type: "string", short: "D" },
  concatenated: { type: "boolean", short: "K" },
} as const;

const UNSUPPORTED: Record<string, string> = {
  large_window: "large-window streams are not RFC 7932 Brotli",
  comment: "the encoder cannot embed stream comments",
  dictionary: "the encoder and decoder take no custom dictionary",
  concatenated: "the decoder accepts exactly one stream per input",
};

function integer(name: string, value: string, valid: (n: number) => boolean, range: string): number {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!valid(n)) throw new UsageError(`invalid ${name} [${value}]: expected ${range}`);
  return n;
}

/**
 * Parses the arguments after the program name. A leading `compress` or `decompress` selects the mode; without one,
 * the command compresses unless `-d` or `-t` is given, as `brotli` does. When an option repeats, the last one wins.
 *
 * @throws UsageError for unknown, unsupported, malformed or conflicting options.
 */
export function parseCli(argv: string[]): CliCommand {
  const command = argv[0] === "compress" || argv[0] === "decompress" ? argv[0] : undefined;
  let tokens;
  try {
    ({ tokens } = parseArgs({ args: command ? argv.slice(1) : argv, options: OPTIONS, allowPositionals: true, tokens: true }));
  } catch (error) {
    // Node.js and Bun: "Unknown option '-x'. To specify a positional argument ..."; the first sentence suffices.
    throw new UsageError((error as Error).message.split(/\.\s/)[0]!);
  }

  const options: CliOptions = {
    mode: command ?? "compress",
    files: [],
    stdout: false,
    output: undefined,
    force: false,
    remove: false,
    squash: false,
    copyStat: true,
    verbose: false,
    quality: 11,
    lgwin: 0,
    suffix: ".br",
    threads: undefined,
  };
  let help = false;
  let version = false;
  for (const token of tokens) {
    if (token.kind === "positional") options.files.push(token.value);
    if (token.kind !== "option") continue;
    const value = token.value ?? "";
    if (token.name in UNSUPPORTED) {
      throw new UsageError(`${token.rawName} is not supported: ${UNSUPPORTED[token.name]}`);
    }
    if (token.name in LEVELS) options.quality = Number(token.name);
    switch (token.name) {
      case "quality":
        options.quality = integer("quality", value, (n) => n <= 11, "an integer from 0 to 11");
        break;
      case "best":
        options.quality = 11;
        break;
      case "lgwin":
        options.lgwin = integer("lgwin", value, (n) => n === 0 || (n >= 10 && n <= 24), "0 or an integer from 10 to 24");
        break;
      case "decompress":
      case "test":
        if (command === "compress") throw new UsageError(`${token.rawName} conflicts with the compress command`);
        // -t wins over -d in either order: testing decompresses without writing.
        if (token.name === "test") options.mode = "test";
        else if (options.mode !== "test") options.mode = "decompress";
        break;
      case "stdout":
        options.stdout = true;
        break;
      case "output":
        options.output = value;
        break;
      case "force":
        options.force = true;
        break;
      case "rm":
        options.remove = true;
        break;
      case "keep":
        options.remove = false;
        break;
      case "squash":
        options.squash = true;
        break;
      case "no-copy-stat":
        options.copyStat = false;
        break;
      case "verbose":
        options.verbose = true;
        break;
      case "threads":
        options.threads = integer("threads", value, (n) => n >= 1, "a positive integer");
        break;
      case "suffix":
        if (!value) throw new UsageError("the suffix must not be empty");
        options.suffix = value;
        break;
      case "help":
        help = true;
        break;
      case "version":
        version = true;
    }
  }
  if (help) return { kind: "help" };
  if (version) return { kind: "version" };

  if (options.files.length === 0) options.files.push("-");
  if (options.files.filter((file) => file === "-").length > 1) {
    throw new UsageError("standard input (-) can be read only once");
  }
  if (options.files.length > 1 && options.mode !== "test" && (options.stdout || options.output !== undefined)) {
    throw new UsageError("-c and -o take exactly one input file");
  }
  // brotli 1.2 deletes the file it has just tested; refusing the combination keeps that file.
  if (options.mode === "test" && options.remove) throw new UsageError("-j cannot be combined with -t");
  return { kind: "run", options };
}

/** The window brotli picks for `-w 0`: the smallest from 10 to 24 whose 2**w - 16 bytes hold the input. */
export function autoLgwin(inputLength: number): number {
  let lgwin = 10;
  while (lgwin < 24 && 2 ** lgwin - 16 < inputLength) lgwin++;
  return lgwin;
}
