// Size report and budget check per import variant: the bytes a browser downloads for one import, raw and with each
// transfer encoding. Every file is compressed on its own, as a CDN or web server does per response.
// usage: node scripts/sizes.mjs <package-dir> [--json <file>] [--markdown]
// Exits 1 when a variant exceeds a limit in size-budgets.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync, zstdCompressSync } from "node:zlib";

// VERIFIED (2026-11-09, defuss-brotli@0.1.3 dist/decompressor.js): jsDelivr's brotli response matches quality 4
// byte for byte, its gzip is within 0.1 % of levels 6-9, and it serves no zstd. q11 and zstd -19 are what
// precompressed static hosting can reach.
const ENCODINGS = {
  raw: (b) => b.length,
  gzip: (b) => gzipSync(b, { level: 9 }).length,
  br4: (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length,
  br11: (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  zstd: (b) => zstdCompressSync(b, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }).length,
};
const LABELS = { raw: "raw", gzip: "gzip -9", br4: "brotli q4 (jsDelivr)", br11: "brotli q11", zstd: "zstd -19" };

const args = process.argv.slice(2);
const packageDir = args[0];
const budgets = JSON.parse(readFileSync(new URL("../size-budgets.json", import.meta.url), "utf8"));
const fileSizes = new Map();
const sizeOf = (file) => {
  if (!fileSizes.has(file)) {
    const bytes = readFileSync(join(packageDir, file));
    fileSizes.set(file, Object.fromEntries(Object.entries(ENCODINGS).map(([k, f]) => [k, f(bytes)])));
  }
  return fileSizes.get(file);
};

const report = [];
const failures = [];
for (const [variant, { files, max }] of Object.entries(budgets.variants)) {
  const total = Object.fromEntries(Object.keys(ENCODINGS).map((k) => [k, files.reduce((s, f) => s + sizeOf(f)[k], 0)]));
  for (const [k, limit] of Object.entries(max)) {
    if (total[k] > limit) failures.push(`${variant} ${LABELS[k]}: ${total[k]} B > budget ${limit} B`);
  }
  report.push({ variant, files, total, max });
}

const fmt = (n) => n.toLocaleString("en-US");
if (args.includes("--markdown")) {
  const keys = Object.keys(ENCODINGS);
  console.log(`| Import | Files | ${keys.map((k) => LABELS[k]).join(" | ")} |`);
  console.log(`|---|---|${keys.map(() => "---:").join("|")}|`);
  for (const { variant, files, total } of report) {
    const names = files.map((f) => `\`${f.replace(/^dist\//, "")}\``).join(" + ");
    console.log(`| \`${variant}\` | ${names} | ${keys.map((k) => `${fmt(total[k])} B`).join(" | ")} |`);
  }
} else {
  for (const { variant, total, max } of report) {
    const cells = Object.keys(ENCODINGS).map((k) => `${k}=${fmt(total[k])}${max[k] ? `/${fmt(max[k])}` : ""}`);
    console.log(`${new Date().toISOString()} INFO size variant=${variant} ${cells.join(" ")}`);
  }
}
const jsonAt = args.indexOf("--json");
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], `${JSON.stringify({ files: Object.fromEntries(fileSizes), report }, null, 2)}\n`);
for (const failure of failures) console.error(`${new Date().toISOString()} ERROR size budget exceeded: ${failure}`);
process.exit(failures.length ? 1 : 0);
