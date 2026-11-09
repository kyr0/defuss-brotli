// Consumer of the packed tarball's `defuss-brotli` command: `make e2e` installs the tarball into a clean project and
// runs this file there. Every command and the main options go through `bunx defuss-brotli` (Node.js, from the
// shebang) and `bunx --bun defuss-brotli` (Bun), on copies of the input/ files, cross-checked against node:zlib.
// VERIFIED: in a project that installed the package, bunx runs its local bin without the registry (a PATH probe
// showed Node.js running it, and Bun with --bun or without Node.js on PATH), so `-V` matching proves the tarball ran.
// usage: node cli.mjs <input-dir> <output-file>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

const [inputDir, outputFile] = process.argv.slice(2).map((path) => resolve(path));
const { version } = JSON.parse(readFileSync("node_modules/defuss-brotli/package.json", "utf8"));
const inputs = readdirSync(inputDir).sort();
const results = [];

for (const runner of [["bunx", "defuss-brotli"], ["bunx", "--bun", "defuss-brotli"]]) {
  const label = runner.join(" ");
  const work = resolve(`work-${runner.length}`);
  mkdirSync(work, { recursive: true });
  for (const file of inputs) copyFileSync(join(inputDir, file), join(work, file));
  const cli = (args, input) => {
    const started = performance.now();
    const result = spawnSync(runner[0], [...runner.slice(1), ...args], { cwd: work, input, maxBuffer: 1 << 28 });
    results.push({ runner: label, args, status: result.status, ms: Math.round(performance.now() - started) });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr.toString() };
  };
  const ok = (args, input) => {
    const result = cli(args, input);
    assert.equal(result.status, 0, `${label} ${args.join(" ")}: ${result.stderr}`);
    return result;
  };

  // -V reports the installed package: bunx ran this tarball, not a registry release.
  assert.equal(ok(["-V"]).stdout.toString(), `defuss-brotli ${version}\n`);
  assert.match(ok(["--help"]).stdout.toString(), /^Usage: defuss-brotli \[compress\|decompress\]/);

  ok(["compress", "-v", ...inputs]);
  for (const file of inputs) {
    const original = readFileSync(join(work, file));
    assert.ok(brotliDecompressSync(readFileSync(join(work, `${file}.br`))).equals(original), `${label}: ${file}.br`);
    const drift = statSync(join(work, `${file}.br`)).mtimeMs - statSync(join(work, file)).mtimeMs;
    assert.ok(Math.abs(drift) < 1, `${label}: ${file} mtime copied (drift ${drift} ms)`);
    ok(["decompress", "-o", `${file}.out`, `${file}.br`]);
    assert.ok(readFileSync(join(work, `${file}.out`)).equals(original), `${label}: ${file} round-trip`);
  }

  // brotli's own spelling: no command word, -d, an existing output refused unless -f.
  const page = readFileSync(join(work, "page.html"));
  assert.match(cli(["page.html"]).stderr, /failed to open output file \[page\.html\.br\]: file already exists/);
  ok(["-d", "-f", "page.html.br"]);
  assert.ok(readFileSync(join(work, "page.html")).equals(page));

  ok(["-t", "page.html.br", "data.json.br"]);
  writeFileSync(join(work, "bad.br"), readFileSync(join(work, "page.html.br")).subarray(0, 64));
  const corrupt = cli(["-t", "bad.br"]);
  assert.equal(corrupt.status, 1);
  assert.match(corrupt.stderr, /^corrupt input \[bad\.br\]: /);

  // Pipes: stdin to stdout both ways, and a zlib-made stream.
  const packed = ok(["-q", "5", "-w", "16"], page).stdout;
  assert.ok(brotliDecompressSync(packed).equals(page));
  assert.ok(ok(["decompress"], packed).stdout.equals(page));
  assert.ok(ok(["-dc", "-"], brotliCompressSync(page)).stdout.equals(page));

  copyFileSync(join(work, "data.json"), join(work, "moved.json"));
  ok(["-j", "moved.json"]);
  assert.ok(!existsSync(join(work, "moved.json")) && existsSync(join(work, "moved.json.br")));

  const unsupported = cli(["-D", "dict", "page.html"]);
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /-D is not supported/);

  // A reader that closes early (`| head`) ends the command without an error message.
  writeFileSync(join(work, "big.br"), brotliCompressSync(Buffer.concat(Array.from({ length: 160 }, () => page))));
  const head = spawnSync("sh", ["-c", `${label} -dc big.br | head -c 16`], { cwd: work });
  assert.equal(head.stdout.toString(), page.subarray(0, 16).toString());
  assert.equal(head.stderr.toString(), "", `${label} | head`);
}

writeFileSync(outputFile, `${JSON.stringify({ version, results }, null, 2)}\n`);
