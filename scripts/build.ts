import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command: string, cwd: string = root) => {
  console.log(`\n> ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
};

// rustc's default wasm32-unknown-unknown features. VERIFIED: `strip = true` drops the target_features section,
// so wasm-opt cannot detect them and rejects the bulk-memory ops rustc emits (validation error, build aborts).
const WASM_FEATURES = [
  "bulk-memory",
  "nontrapping-float-to-int",
  "sign-ext",
  "mutable-globals",
  "multivalue",
  "reference-types",
].map((f) => `--enable-${f}`);

rmSync(join(root, "dist"), { recursive: true, force: true });
rmSync(join(root, "wasm", "pkg"), { recursive: true, force: true });

for (const name of ["compressor", "decompressor"]) {
  const pkg = join(root, "wasm", "pkg", name);
  const stem = join(pkg, `defuss_brotli_${name}`);
  run(`wasm-pack build --release --target bundler --out-dir ../../wasm/pkg/${name} .`, join(root, "rust", name));
  // VERIFIED: -O3 (with opt-level 3) over -Oz (with opt-level "s") is 1.3-1.7x faster for +1.2 % brotli-compressed
  // size; -Oz even grows the gzip size of the compressor (ARCH.md, "Why this design").
  run(`wasm-opt -O3 ${WASM_FEATURES.join(" ")} -o ${stem}_bg.wasm ${stem}_bg.wasm`);

  const wasm = readFileSync(`${stem}_bg.wasm`);
  writeFileSync(join(pkg, "wasm_base64.js"), `export default "${wasm.toString("base64")}";\n`);
  writeFileSync(join(pkg, "wasm_base64.d.ts"), "declare const wasmBase64: string;\nexport default wasmBase64;\n");
  // The `_bg.js` glue ships without types; its exports are the entry's plus the instance setter.
  writeFileSync(
    `${stem}_bg.d.ts`,
    `${readFileSync(`${stem}.d.ts`, "utf-8")}export function __wbg_set_wasm(exports: WebAssembly.Exports): void;\n`,
  );
  console.log(`  ${name}: ${wasm.length} bytes WASM`);

  // Two delivery modes per crate, same API: dist/NAME.js inlines the binary, dist/NAME-slim.js loads dist/NAME.wasm.
  run(`bun build src/${name}.ts --format esm --target browser --minify --outfile dist/${name}.js`);
  run(`bun build src/${name}-slim.ts --format esm --target browser --minify --outfile dist/${name}-slim.js`);
  mkdirSync(join(root, "dist"), { recursive: true });
  copyFileSync(`${stem}_bg.wasm`, join(root, "dist", `${name}.wasm`));
}

run("bunx tsc --project tsconfig.build.json");
