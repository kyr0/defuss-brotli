// Builds the GitHub Pages site into docs/ from site/: the page with both languages, highlighted code, the measured
// data and the static first chart table; the bundled page script; the library files the demos load; samples.
// usage: bun site/build.ts   (after `make build`, which produces dist/)
// The page renders without JavaScript and from disk: content, code colours and the first table are in the HTML.
// VERIFIED: site/e2e.mjs opens docs/index.html from disk and finds the text, coloured code, the table and site.css.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expand, templates } from "./lib/catalog.js";
import { chartTable, tableHtml, type Bench, type CliData } from "./lib/charts.js";
import { renderSnippets } from "./code.js";
import { compress, init } from "../dist/compressor.js";

// Bun's bundler, the one Bun API this script uses (the repository's types are Node.js's).
declare const Bun: {
  build(options: { entrypoints: string[]; format: "iife"; target: "browser"; minify: boolean; sourcemap: "none" }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: Array<{ text(): Promise<string> }>;
  }>;
};

const site = dirname(fileURLToPath(import.meta.url));
const root = join(site, "..");
const out = join(root, "docs");
const assets = join(out, "assets");
const log = (message: string) => console.log(`${new Date().toISOString()} INFO ${message}`);

// Pinned CDN files with Subresource Integrity (sha384 of the exact bytes, computed 2026-11-09).
const SHADCN = "https://cdn.jsdelivr.net/gh/kyr0/defuss-shadcn@0.9.13/dist";
const STYLES = [
  [`${SHADCN}/components/core.min.css`, "sha384-qUQCm/MM2DNkdT3uEdx8Mpocj+GwXlgLat0FnWv657c16tHWOouZFT2nV7kg5pBE"],
  [`${SHADCN}/theme/utils/shapes.min.css`, "sha384-kvFwbKkyut1la4E1oBfImp6tvRZsBSKiVEu6vX+V1r0MIPS6LlN/52Vaa3qrAbSc"],
  [`${SHADCN}/components/all.min.css`, "sha384-vB1PejcxP+B7v4xfBBV7nxNuX/M3cDqmOv1bNhU/BMOlAh5h3NWG4aKtcAlws/Xh"],
  [`${SHADCN}/components/shaders.min.css`, "sha384-+y3ugMzY7jrZ6VYD8ynPBGVMcrM/qOaHI7Eeac//NqAtcDRBYAzHqfZcbRBN3VeP"],
];
const SCRIPTS = [
  [`${SHADCN}/components/all.min.js`, "sha384-TmkH79IpYKAuexQw5i80JoentBsM0UsBg74rGr0zKEj2iNQwuCmWWRulohr0Z0as"],
  [`${SHADCN}/components/shaders.min.js`, "sha384-dPWu1F8nFNKt5r6WTNrSYJWS+EdP+0D/lSBqFkKnli8b68mvzXjcr50YfXDGk7LA"],
];
// ECharts loads when the performance section comes near (site/main.ts), so it is a URL and hash for the script.
export const ECHARTS = ["https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js", "sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD"];

function replaceOnce(html: string, marker: string, value: string): string {
  if (!html.includes(marker)) throw new Error(`marker ${marker} missing from site/page.html`);
  return html.replace(marker, () => value);
}

const bench = JSON.parse(readFileSync(join(site, "data/bench.json"), "utf8")) as Bench;
const cli = JSON.parse(readFileSync(join(site, "data/cli.json"), "utf8")) as CliData;

// The page: catalog, code, data, CDN tags.
let { html, entries } = expand(readFileSync(join(site, "page.html"), "utf8"));
const snippets = await renderSnippets();
html = html.replace(/<div data-code="([a-z]+)"><\/div>/g, (_m, name: string) => {
  const code = snippets[name];
  if (!code) throw new Error(`unknown code snippet ${name}`);
  return code;
});
html = replaceOnce(html, "<!--i18n-templates-->", templates(entries));
html = replaceOnce(html, "<!--perf-table-->", tableHtml(chartTable(bench, cli, { view: "quality", input: "html", metric: "size" }, "en")));
// `<` escaped, so no value can end the script element early.
html = replaceOnce(html, "<!--perf-data-->", JSON.stringify({ bench, cli, echarts: ECHARTS }).replace(/</g, "\\u003c"));
html = replaceOnce(
  html,
  "<!--cdn-styles-->",
  STYLES.map(([href, sri]) => `<link rel="stylesheet" href="${href}" integrity="${sri}" crossorigin="anonymous">`).join("\n  "),
);
html = replaceOnce(
  html,
  "<!--cdn-scripts-->",
  SCRIPTS.map(([src, sri]) => `<script type="module" src="${src}" integrity="${sri}" crossorigin="anonymous"></script>`).join("\n"),
);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(assets, "lib"), { recursive: true });
mkdirSync(join(assets, "samples"), { recursive: true });
mkdirSync(join(assets, "fonts"), { recursive: true });
writeFileSync(join(out, "index.html"), html);
log(`page docs/index.html bytes=${html.length} i18n_targets=${entries.length}`);

// The page script: one classic script (it also runs from disk, where browsers refuse local module scripts).
const bundle = await Bun.build({
  entrypoints: [join(site, "main.ts")],
  format: "iife",
  target: "browser",
  minify: true,
  sourcemap: "none",
});
if (!bundle.success) throw new AggregateError(bundle.logs, "site/main.ts failed to bundle");
writeFileSync(join(assets, "site.js"), await bundle.outputs[0]!.text());

const copy = (from: string, to: string) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};
for (const file of ["site.css", "favicon.svg", "aron-homberg.jpg"]) copy(join(site, "assets", file), join(assets, file));
const font = join(root, "node_modules/@fontsource-variable/bricolage-grotesque");
copy(join(font, "files/bricolage-grotesque-latin-wght-normal.woff2"), join(assets, "fonts/bricolage-grotesque-latin-wght-normal.woff2"));
copy(join(font, "LICENSE"), join(assets, "fonts/LICENSE-bricolage-grotesque.txt")); // SIL OFL 1.1 travels with the font
// The demos load the library exactly as an app does: the slim entry points and their .wasm files, from dist/.
for (const file of ["compressor-slim.js", "compressor.wasm", "decompressor-slim.js", "decompressor.wasm"]) {
  copy(join(root, "dist", file), join(assets, "lib", file));
}
copy(join(root, "THIRD_PARTY_NOTICES.txt"), join(assets, "lib", "THIRD_PARTY_NOTICES.txt"));

// Samples, and a .br made by this build, so the decompress demo has a file that a real server stored.
await init();
const page = readFileSync(join(root, "input/page.html"));
writeFileSync(join(assets, "samples/page.html"), page);
writeFileSync(join(assets, "samples/page.html.br"), compress(page, { quality: 11 }));
copy(join(root, "input/data.json"), join(assets, "samples/data.json"));
writeFileSync(join(assets, "samples/drawing.svg"), readFileSync(join(root, "huge.svg")).subarray(0, 1024 * 1024));

copy(join(site, "llms.txt"), join(out, "llms.txt"));
writeFileSync(join(out, "CNAME"), "brotli.defuss.org"); // as GitHub created it, without a newline
writeFileSync(join(out, ".nojekyll"), "");
log("site built into docs/");
