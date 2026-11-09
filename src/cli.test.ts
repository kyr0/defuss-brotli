// The CLI in-process on throwaway directories, with real files and streams. Expected behavior is the brotli 1.2.0
// CLI's, observed on 2026-11-09 (defaults, file naming, guards, messages); `make e2e` runs the installed command.
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { autoLgwin, HELP, parseCli, UsageError, type CliOptions } from "./cli-args";
import { run } from "./cli";
import * as compressor from "./compressor-slim";

const PAGE = readFileSync(new URL("../input/page.html", import.meta.url));
const wasm = {
  compressor: () => new URL("../wasm/pkg/compressor/defuss_brotli_compressor_bg.wasm", import.meta.url),
  decompressor: () => new URL("../wasm/pkg/decompressor/defuss_brotli_decompressor_bg.wasm", import.meta.url),
};

async function cli(argv: string[], { stdin = new Uint8Array(), stdinTTY = false, stdoutTTY = false } = {}) {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const stdout = Object.assign(new PassThrough(), { isTTY: stdoutTTY });
  const stderr = new PassThrough();
  stdout.on("data", (chunk: Buffer) => out.push(chunk));
  stderr.on("data", (chunk: Buffer) => err.push(chunk));
  const input = Object.assign(Readable.from([Buffer.from(stdin)]), { isTTY: stdinTTY });
  const code = await run(argv, { stdin: input, stdout, stderr, version: "1.2.3", wasm });
  await new Promise(setImmediate);
  return { code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() };
}

const options = (argv: string[]): CliOptions => {
  const command = parseCli(argv);
  if (command.kind !== "run") throw new Error(`expected a run command, got ${command.kind}`);
  return command.options;
};

describe("parseCli", () => {
  test("defaults match brotli: compress at quality 11, auto window, .br suffix, keep sources, standard input", () => {
    expect(options([])).toEqual({
      mode: "compress",
      files: ["-"],
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
    });
  });

  test("brotli's option forms: coalesced flags, -#, -qNUM, -q NUM, --quality=NUM, and the last option wins", () => {
    expect(options(["-9kf", "a"])).toMatchObject({ quality: 9, force: true, remove: false, files: ["a"] });
    expect(options(["-q11"]).quality).toBe(11);
    expect(options(["-q", "3"]).quality).toBe(3);
    expect(options(["--quality=5"]).quality).toBe(5);
    expect(options(["--quality", "5"]).quality).toBe(5);
    expect(options(["-q", "3", "-Z"]).quality).toBe(11);
    expect(options(["-Z", "-4"]).quality).toBe(4);
    expect(options(["-j", "-k"]).remove).toBe(false);
    expect(options(["-k", "-j"]).remove).toBe(true);
    expect(options(["-w", "0"]).lgwin).toBe(0);
    expect(options(["--threads=4"]).threads).toBe(4);
    expect(options(["--lgwin=24", "-S", ".brotli", "-o", "out", "-cnsv", "x"])).toMatchObject({
      lgwin: 24,
      suffix: ".brotli",
      output: "out",
      stdout: true,
      copyStat: false,
      squash: true,
      verbose: true,
    });
  });

  test("the command word or -d/-t selects the mode; -t wins over -d", () => {
    expect(options(["decompress", "a.br"])).toMatchObject({ mode: "decompress", files: ["a.br"] });
    expect(options(["compress", "a"])).toMatchObject({ mode: "compress", files: ["a"] });
    expect(options(["-d", "a.br"]).mode).toBe("decompress");
    expect(options(["decompress", "-t"]).mode).toBe("test");
    expect(options(["-t", "-d"]).mode).toBe("test");
    // Only the first argument is a command word; after `--` everything is a file.
    expect(options(["a", "decompress"])).toMatchObject({ mode: "compress", files: ["a", "decompress"] });
    expect(options(["--", "-d"])).toMatchObject({ mode: "compress", files: ["-d"] });
  });

  test("help and version take precedence over the other options", () => {
    expect(parseCli(["-d", "-h", "x"])).toEqual({ kind: "help" });
    expect(parseCli(["decompress", "--version"])).toEqual({ kind: "version" });
  });

  test.each([
    [["-q", "12"], "invalid quality [12]: expected an integer from 0 to 11"],
    [["-q", "x"], "invalid quality [x]"],
    [["-w", "9"], "invalid lgwin [9]: expected 0 or an integer from 10 to 24"],
    [["-w", "25"], "invalid lgwin [25]"],
    [["-D", "dict"], "-D is not supported"],
    [["-K"], "-K is not supported"],
    [["--comment=QUJD"], "--comment is not supported"],
    [["--large_window=30"], "--large_window is not supported"],
    [["-x"], "Unknown option '-x'"],
    [["-o", "-x"], /^Option '-o(, --output <value>)?' argument is ambiguous$/],
    [["-c", "a", "b"], "-c and -o take exactly one input file"],
    [["-o", "out", "a", "b"], "-c and -o take exactly one input file"],
    [["-t", "-j", "a.br"], "-j cannot be combined with -t"],
    [["-", "-"], "standard input (-) can be read only once"],
    [["-S", ""], "the suffix must not be empty"],
    [["--threads=0"], "invalid threads [0]: expected a positive integer"],
    [["compress", "-d"], "-d conflicts with the compress command"],
  ])("rejects %j", (argv, expected) => {
    expect(() => parseCli(argv)).toThrowError(UsageError);
    expect(() => parseCli(argv)).toThrowError(expected);
  });

  test("-t accepts several files, as it writes nothing", () => {
    expect(options(["-t", "-c", "a.br", "b.br"]).files).toEqual(["a.br", "b.br"]);
  });
});

describe("autoLgwin", () => {
  test("picks the smallest window whose 2**w - 16 bytes hold the input, from 10 to 24", () => {
    // VERIFIED: `brotli` 1.2.0 output for input/page.html (29,175 B) equals `brotli -w 15`, not `-w 24`.
    expect(autoLgwin(29_175)).toBe(15);
    expect(autoLgwin(0)).toBe(10);
    expect(autoLgwin(2 ** 15 - 16)).toBe(15);
    expect(autoLgwin(2 ** 15 - 15)).toBe(16);
    expect(autoLgwin(2 ** 30)).toBe(24);
  });
});

describe("run", () => {
  let dir: string;
  let page: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "defuss-brotli-cli-"));
    page = join(dir, "page.html");
    writeFileSync(page, PAGE);
    chmodSync(page, 0o640);
    utimesSync(page, new Date("2020-01-01T01:01:00Z"), new Date("2020-01-01T01:01:00Z"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("compresses FILE to FILE.br with the auto window, keeps the source and copies its mode and times", async () => {
    await compressor.init(wasm.compressor());
    expect(await cli([page])).toEqual({ code: 0, stdout: Buffer.alloc(0), stderr: "" });
    const packed = readFileSync(`${page}.br`);
    expect(brotliDecompressSync(packed).equals(PAGE)).toBe(true);
    expect(packed.equals(compressor.compress(PAGE, { quality: 11, lgwin: autoLgwin(PAGE.length) }))).toBe(true);
    expect(existsSync(page)).toBe(true);
    expect(statSync(`${page}.br`).mode & 0o777).toBe(0o640);
    expect(statSync(`${page}.br`).mtimeMs).toBe(statSync(page).mtimeMs);
  });

  test("compresses inputs above 32 KiB in parallel parts; --threads changes only the speed", async () => {
    const big = join(dir, "big.html");
    const data = Buffer.concat(Array.from({ length: 12 }, () => PAGE));
    writeFileSync(big, data);
    expect((await cli([big])).code).toBe(0);
    const packed = readFileSync(`${big}.br`);
    expect(brotliDecompressSync(packed).equals(data)).toBe(true);
    expect(packed.equals(await compressor.compressParallel(data, { lgwin: autoLgwin(data.length) }))).toBe(true);
    expect((await cli(["-c", "--threads=1", big])).stdout.equals(packed)).toBe(true);
  });

  test("-n does not copy mode and times; -q and -w set the encoder", async () => {
    expect((await cli(["compress", "-n", "-q", "1", "-w", "10", page])).code).toBe(0);
    expect(statSync(`${page}.br`).mtimeMs).not.toBe(statSync(page).mtimeMs);
    expect(brotliDecompressSync(readFileSync(`${page}.br`)).equals(PAGE)).toBe(true);
  });

  test("refuses to overwrite an existing output without -f", async () => {
    writeFileSync(`${page}.br`, "keep me");
    const refused = await cli([page]);
    expect(refused).toMatchObject({ code: 1, stderr: `failed to open output file [${page}.br]: file already exists\n` });
    expect(readFileSync(`${page}.br`, "utf8")).toBe("keep me");
    expect((await cli(["-f", page])).code).toBe(0);
    expect(brotliDecompressSync(readFileSync(`${page}.br`)).equals(PAGE)).toBe(true);
  });

  test("decompresses FILE.br to FILE, to -o FILE and with -S SUF, including node:zlib streams", async () => {
    const zlibPacked = brotliCompressSync(PAGE);
    writeFileSync(join(dir, "z.html.br"), zlibPacked);
    writeFileSync(join(dir, "z.html.xz"), zlibPacked);
    expect((await cli(["decompress", join(dir, "z.html.br")])).code).toBe(0);
    expect(readFileSync(join(dir, "z.html")).equals(PAGE)).toBe(true);
    expect((await cli(["-d", "-o", join(dir, "out.html"), join(dir, "z.html.br")])).code).toBe(0);
    expect(readFileSync(join(dir, "out.html")).equals(PAGE)).toBe(true);
    expect((await cli(["-df", "-S", ".xz", join(dir, "z.html.xz")])).code).toBe(0);
  });

  test("decompressing a file without the suffix fails before reading it", async () => {
    expect(await cli(["-d", page])).toMatchObject({ code: 1, stderr: `input file [${page}] suffix mismatch\n` });
    writeFileSync(join(dir, ".br"), brotliCompressSync(PAGE));
    expect(await cli(["-d", join(dir, ".br")])).toMatchObject({ code: 1, stderr: `input file [${join(dir, ".br")}] suffix mismatch\n` });
  });

  test("reads standard input and writes standard output; -c writes a file's output there", async () => {
    const packed = await cli(["-q", "5"], { stdin: PAGE });
    expect(packed).toMatchObject({ code: 0, stderr: "" });
    expect(brotliDecompressSync(packed.stdout).equals(PAGE)).toBe(true);
    expect((await cli(["decompress", "-"], { stdin: packed.stdout })).stdout.equals(PAGE)).toBe(true);
    const fromFile = await cli(["-c", page]);
    expect(brotliDecompressSync(fromFile.stdout).equals(PAGE)).toBe(true);
    expect(existsSync(`${page}.br`)).toBe(false);
    expect((await cli(["-o", join(dir, "stdin.br")], { stdin: PAGE })).code).toBe(0);
    expect(brotliDecompressSync(readFileSync(join(dir, "stdin.br"))).equals(PAGE)).toBe(true);
  });

  test("compressed output to a terminal and terminal input need -f; decompressed output may go to a terminal", async () => {
    expect(await cli(["-c", page], { stdoutTTY: true })).toMatchObject({
      code: 1,
      stderr: "Use -h help. Use -f to force output to a terminal.\n",
    });
    expect(await cli(["-o", join(dir, "x.br")], { stdinTTY: true })).toMatchObject({
      code: 1,
      stderr: "Use -h help. Use -f to force input from a terminal.\n",
    });
    expect((await cli(["-cf", page], { stdoutTTY: true })).code).toBe(0);
    const packed = brotliCompressSync(PAGE);
    expect((await cli(["-d"], { stdin: packed, stdoutTTY: true })).stdout.equals(PAGE)).toBe(true);
  });

  test("-t decompresses without writing; a corrupt input fails and stops before the next file", async () => {
    const good = join(dir, "good.br");
    const bad = join(dir, "bad.br");
    writeFileSync(good, brotliCompressSync(PAGE));
    writeFileSync(bad, brotliCompressSync(PAGE).subarray(0, 100));
    expect(await cli(["-t", good, good])).toEqual({ code: 0, stdout: Buffer.alloc(0), stderr: "" });
    expect(existsSync(join(dir, "good"))).toBe(false);
    expect(await cli(["-t", bad])).toMatchObject({ code: 1, stderr: `corrupt input [${bad}]: truncated brotli stream\n` });
    expect((await cli(["-d", bad, good])).code).toBe(1);
    expect(existsSync(join(dir, "bad"))).toBe(false);
    expect(existsSync(join(dir, "good"))).toBe(false);
  });

  test("-j removes the source after writing; -s drops a larger output and then keeps the source", async () => {
    expect((await cli(["-j", page])).code).toBe(0);
    expect(existsSync(page)).toBe(false);
    expect(brotliDecompressSync(readFileSync(`${page}.br`)).equals(PAGE)).toBe(true);

    const tiny = join(dir, "tiny.txt");
    writeFileSync(tiny, "abc");
    expect((await cli(["-s", "-j", tiny])).code).toBe(0);
    expect(existsSync(`${tiny}.br`)).toBe(false);
    expect(readFileSync(tiny, "utf8")).toBe("abc");
  });

  test("-v reports each file on stderr in brotli's format", async () => {
    const { code, stderr } = await cli(["-v", page]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/^Compressed \[.*page\.html\]: 28\.491 KiB -> \d+ B in \d+\.\d\d sec\n$/);
    expect((await cli(["-tv", `${page}.br`])).stderr).toMatch(/^Decompressed \[.*page\.html\.br\]: \d+ B -> 28\.491 KiB in /);
    const big = await cli(["-v", "-q", "0", "-c"], { stdin: new Uint8Array(3 * 2 ** 20) });
    expect(big.stderr).toMatch(/^Compressed \[stdin\]: 3\.000 MiB -> /);
  });

  test("an unreadable input or an output that is the input fails with the file in the message", async () => {
    const missing = join(dir, "missing");
    expect(await cli([missing])).toMatchObject({
      code: 1,
      stderr: `failed to open input file [${missing}]: no such file or directory\n`,
    });
    expect(await cli(["-f", "-o", page, page])).toMatchObject({
      code: 1,
      stderr: `input and output are the same file [${page}]\n`,
    });
    expect(readFileSync(page).equals(PAGE)).toBe(true);
  });

  test("usage errors print a hint on stderr only; -h and -V print to stdout", async () => {
    expect(await cli(["-q", "12", page])).toEqual({
      code: 1,
      stdout: Buffer.alloc(0),
      stderr: "invalid quality [12]: expected an integer from 0 to 11\nUse -h for help.\n",
    });
    expect((await cli(["-h"])).stdout.toString()).toBe(HELP);
    expect((await cli(["-V"])).stdout.toString()).toBe("defuss-brotli 1.2.3\n");
  });
});
