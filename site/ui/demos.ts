// The three live demos. They load the library as an app does, from the slim entry points next to this page
// (assets/lib/), so the decoder demo can show what the decoder alone costs to download. Bundling the library into
// the page script would hide exactly that. VERIFIED: every demo runs in the site e2e, a corrupt file shows an error.
import { bytes, duration, factor, percent } from "../lib/format.js";
import { highlightCall } from "../lib/callcode.js";
import { logLines } from "../lib/logs.js";
import { $, countUp, locale, msg, onLocale, painted, press } from "./shared.js";

interface Compressor {
  init(): Promise<void>;
  compress(input: Uint8Array, options?: { quality?: number; lgwin?: number }): Uint8Array;
  compressParallel(input: Uint8Array, options?: { quality?: number; lgwin?: number; threads?: number }): Promise<Uint8Array>;
}
interface Decompressor {
  init(): Promise<void>;
  decompress(input: Uint8Array, options?: { maxOutputSize?: number }): Uint8Array;
}

const LIB = new URL("assets/lib/", document.baseURI);
const MAX_FILE = 64 * 1024 * 1024;
const once = <T>(load: () => Promise<T>) => {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load().catch((error) => ((pending = undefined), Promise.reject(error))));
};
// A computed URL keeps the bundler from inlining the library: the page loads the published files themselves.
const importFrom = (file: string) => import(/* @vite-ignore */ new URL(file, LIB).href);
export const compressor = once(async () => {
  const module = (await importFrom("compressor-slim.js")) as Compressor;
  await module.init();
  return module;
});
export const decompressor = once(async () => {
  const module = (await importFrom("decompressor-slim.js")) as Decompressor;
  await module.init();
  return module;
});

const SAMPLES: Record<string, () => Promise<Uint8Array>> = {
  html: () => fetchBytes("assets/samples/page.html"),
  json: () => fetchBytes("assets/samples/data.json"),
  svg: () => fetchBytes("assets/samples/drawing.svg"),
  logs: async () => logLines(2 * 1024 * 1024),
};
const NAMES: Record<string, string> = { html: "page.html", json: "data.json", svg: "drawing.svg", logs: "logs.jsonl" };

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** gzip by the browser's own CompressionStream, the baseline every page already has. */
async function gzip(input: Uint8Array): Promise<{ size: number; ms: number } | null> {
  if (typeof CompressionStream !== "function") return null;
  const start = performance.now();
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const size = (await new Response(stream).arrayBuffer()).byteLength;
  return { size, ms: performance.now() - start };
}

function failure(target: HTMLElement, error: unknown): void {
  const offline = location.protocol === "file:";
  target.textContent = offline ? msg("offline") : msg("error", { message: error instanceof Error ? error.message : String(error) });
  target.closest(".result")?.setAttribute("data-state", "error");
}

const setCode = (id: string, code: string) => {
  $(`#${id} code`).innerHTML = highlightCall(code);
};

// ---------------------------------------------------------------- compress

interface CompressResult {
  name: string;
  input: number;
  output: number;
  ms: number;
  quality: number;
  gzip: { size: number; ms: number } | null;
  packed: Uint8Array;
}
let lastCompressed: CompressResult | undefined;
let compressUrl: string | undefined;

function renderCompress(result: CompressResult, animate: boolean): void {
  const l = locale();
  const times = result.input / Math.max(result.output, 1);
  const big = $("#compress-ratio");
  const text = (n: number) => msg("smaller", { times: factor(n, l) });
  if (animate) countUp(big, times, text);
  else big.textContent = text(times);
  $("#compress-summary").textContent = msg("compress-done", {
    output: bytes(result.output, l),
    input: bytes(result.input, l),
    time: duration(result.ms, l),
    quality: result.quality,
  });
  const bars: Record<string, [number, string]> = {
    input: [result.input, bytes(result.input, l)],
    gzip: result.gzip ? [result.gzip.size, bytes(result.gzip.size, l)] : [0, msg("gzip-unavailable")],
    brotli: [result.output, bytes(result.output, l)],
  };
  for (const [name, [size, label]] of Object.entries(bars)) {
    const bar = $(`#compress-bars [data-bar="${name}"]`);
    $(".bar-fill", bar).style.setProperty("--fill", `${Math.max((size / result.input) * 100, size ? 0.6 : 0)}%`);
    $(".bar-value", bar).textContent = label;
  }
  $("#compress-bar-q").textContent = msg("bar-quality", { quality: result.quality });
  $("#compress-check").hidden = false;
}

async function runCompress(): Promise<void> {
  const form = $<HTMLFormElement>("#compress-form");
  const summary = $("#compress-summary");
  const result = $("#compress-result");
  const quality = Number($<HTMLInputElement>("#compress-quality").value);
  const lgwin = Number($<HTMLInputElement>("#compress-lgwin").value);
  const threads = Number($<HTMLInputElement>("#compress-threads").value);
  let source = $("#compress-source").querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.value ?? "sample";
  // no file chosen yet: the sample keeps the demo working instead of failing
  if (source === "file" && !$<HTMLInputElement>("#compress-file").files?.length) {
    source = "sample";
    press($("#compress-source"), source);
    showSource(source);
  }
  result.setAttribute("aria-busy", "true");
  result.removeAttribute("data-state");
  form.inert = true;
  try {
    summary.textContent = msg("loading-input");
    let input: Uint8Array;
    let name: string;
    if (source === "text") {
      input = new TextEncoder().encode($<HTMLTextAreaElement>("#compress-text").value);
      name = "text.txt";
    } else if (source === "file") {
      const file = $<HTMLInputElement>("#compress-file").files![0]!;
      if (file.size > MAX_FILE) throw new Error(`${file.name}: ${bytes(file.size, locale())} > ${bytes(MAX_FILE, locale())}`);
      input = new Uint8Array(await file.arrayBuffer());
      name = file.name;
    } else {
      const sample = $<HTMLSelectElement>("#compress-sample").value;
      input = await SAMPLES[sample]!();
      name = NAMES[sample]!;
    }
    summary.textContent = msg("loading-encoder");
    const lib = await compressor();
    summary.textContent = msg("compressing", { size: bytes(input.length, locale()) });
    await painted();
    const parallel = threads > 1;
    const start = performance.now();
    const packed = parallel ? await lib.compressParallel(input, { quality, lgwin, threads }) : lib.compress(input, { quality, lgwin });
    const ms = performance.now() - start;
    setCode(
      "compress-code",
      parallel
        ? `await compressParallel(input, { quality: ${quality}, lgwin: ${lgwin}, threads: ${threads} })`
        : `compress(input, { quality: ${quality}, lgwin: ${lgwin} })`,
    );
    const baseline = await gzip(input);
    const decoder = await decompressor();
    const back = decoder.decompress(packed, { maxOutputSize: Math.max(input.length, 1) });
    if (!equal(back, input)) throw new Error("round trip differs");
    lastCompressed = { name, input: input.length, output: packed.length, ms, quality, gzip: baseline, packed };
    renderCompress(lastCompressed, true);
    if (compressUrl) URL.revokeObjectURL(compressUrl);
    compressUrl = URL.createObjectURL(new Blob([packed as BlobPart], { type: "application/octet-stream" }));
    const download = $<HTMLAnchorElement>("#compress-download");
    download.href = compressUrl;
    download.download = `${name}.br`;
    download.hidden = false;
    $("#compress-to-decoder").hidden = false;
    $<HTMLInputElement>("#decompress-last").disabled = false;
  } catch (error) {
    failure(summary, error);
  } finally {
    form.inert = false;
    result.removeAttribute("aria-busy");
  }
}

function showSource(source: string): void {
  for (const pane of document.querySelectorAll<HTMLElement>("#compress-form [data-source]")) pane.hidden = pane.dataset.source !== source;
}

// ---------------------------------------------------------------- decompress

interface DecompressResult {
  input: number;
  output: Uint8Array;
  ms: number;
}
let lastDecompressed: DecompressResult | undefined;

function decoderDownload(): string {
  const files = performance
    .getEntriesByType("resource")
    .filter((e) => /\/(decompressor-slim\.js|decompressor\.wasm)$/.test(e.name)) as PerformanceResourceTiming[];
  if (files.length < 2) return "-";
  const transferred = files.reduce((sum, e) => sum + e.transferSize, 0);
  const encoded = files.reduce((sum, e) => sum + e.encodedBodySize, 0);
  return transferred > 0
    ? msg("decoder-bytes", { bytes: bytes(transferred, locale()) })
    : `${bytes(encoded, locale())}, ${msg("decoder-cached")}`;
}

function renderDecompress(result: DecompressResult, animate: boolean): void {
  const l = locale();
  const big = $("#decompress-size");
  if (animate) countUp(big, result.output.length, (n) => bytes(Math.round(n), l));
  else big.textContent = bytes(result.output.length, l);
  $("#decompress-summary").textContent = msg("decompress-done", { input: bytes(result.input, l), time: duration(result.ms, l) });
  $("#decoder-bytes").textContent = decoderDownload();
  const preview = $("#decompress-preview");
  try {
    preview.textContent = new TextDecoder("utf-8", { fatal: true }).decode(result.output.subarray(0, 4000)).slice(0, 1500);
  } catch {
    const hex = Array.from(result.output.subarray(0, 192), (b) => b.toString(16).padStart(2, "0"));
    const rows = [];
    for (let i = 0; i < hex.length; i += 16) rows.push(hex.slice(i, i + 16).join(" "));
    preview.textContent = `${msg("binary-preview")}\n${rows.join("\n")}`;
  }
}

async function runDecompress(): Promise<void> {
  const form = $<HTMLFormElement>("#decompress-form");
  const summary = $("#decompress-summary");
  const result = $("#decompress-result");
  const source = form.querySelector<HTMLInputElement>('input[name="decompress-source"]:checked')?.value ?? "sample";
  result.setAttribute("aria-busy", "true");
  result.removeAttribute("data-state");
  form.inert = true;
  try {
    let packed: Uint8Array;
    let label: string;
    if (source === "last" && lastCompressed) {
      packed = lastCompressed.packed;
      label = `${lastCompressed.name}.br`;
    } else if (source === "file" && $<HTMLInputElement>("#decompress-file").files?.[0]) {
      const file = $<HTMLInputElement>("#decompress-file").files![0]!;
      if (file.size > MAX_FILE) throw new Error(`${file.name}: ${bytes(file.size, locale())} > ${bytes(MAX_FILE, locale())}`);
      packed = new Uint8Array(await file.arrayBuffer());
      label = file.name;
    } else {
      form.querySelector<HTMLInputElement>('input[value="sample"]')!.checked = true;
      showDecompressSource("sample");
      packed = await fetchBytes("assets/samples/page.html.br");
      label = "page.html.br";
    }
    summary.textContent = msg("loading-decoder");
    const lib = await decompressor();
    summary.textContent = msg("decompressing");
    await painted();
    const start = performance.now();
    const output = lib.decompress(packed, { maxOutputSize: 256 * 1024 * 1024 });
    const ms = performance.now() - start;
    setCode("decompress-code", `decompress(bytes) // ${label}`);
    lastDecompressed = { input: packed.length, output, ms };
    renderDecompress(lastDecompressed, true);
  } catch (error) {
    failure(summary, error);
  } finally {
    form.inert = false;
    result.removeAttribute("aria-busy");
  }
}

function showDecompressSource(source: string): void {
  $<HTMLElement>('#decompress-form [data-source="file"]').hidden = source !== "file";
}

// ---------------------------------------------------------------- race

interface RaceResult {
  name: string;
  input: number;
  single: number;
  parallel: number;
  threads: number;
  delta: number;
}
let lastRace: RaceResult | undefined;

function renderRace(result: RaceResult, animate: boolean): void {
  const l = locale();
  const times = result.single / result.parallel;
  const big = $("#race-speedup");
  const text = (n: number) => msg("faster", { times: factor(n, l) });
  if (animate) countUp(big, times, text);
  else big.textContent = text(times);
  $("#race-summary").textContent = msg("race-done", {
    input: `${result.name}, ${bytes(result.input, l)}`,
    parallel: duration(result.parallel, l),
    single: duration(result.single, l),
    threads: result.threads,
  });
  const slow = Math.max(result.single, result.parallel);
  for (const [lane, ms] of [["parallel", result.parallel], ["single", result.single]] as const) {
    const element = $(`#lane-${lane}`);
    $(".lane-fill", element).style.setProperty("--fill", `${(ms / slow) * 100}%`);
    $(".lane-time", element).textContent = duration(ms, l);
  }
  $("#lane-parallel-threads").textContent = msg("workers", { n: result.threads });
  $("#race-check-text").textContent = msg("race-check", { delta: percent(result.delta, l, 2) });
  $("#race-check").hidden = false;
}

async function runRace(): Promise<void> {
  const form = $<HTMLFormElement>("#race-form");
  const summary = $("#race-summary");
  const result = $("#race-result");
  const sample = $<HTMLSelectElement>("#race-sample").value;
  const threads = Number($<HTMLInputElement>("#race-threads").value);
  result.setAttribute("aria-busy", "true");
  result.removeAttribute("data-state");
  form.inert = true;
  try {
    summary.textContent = msg("loading-input");
    const input = await SAMPLES[sample]!();
    summary.textContent = msg("loading-encoder");
    const lib = await compressor();
    const decoder = await decompressor();
    for (const lane of ["parallel", "single"]) $(`#lane-${lane}`).removeAttribute("data-done");
    summary.textContent = msg("race-running-parallel", { threads });
    $("#lane-parallel").setAttribute("data-running", "");
    await painted();
    let start = performance.now();
    const fast = await lib.compressParallel(input, { quality: 11, threads });
    const parallel = performance.now() - start;
    $("#lane-parallel").removeAttribute("data-running");
    $(".lane-time", $("#lane-parallel")).textContent = duration(parallel, locale());
    summary.textContent = msg("race-running-single");
    $("#lane-single").setAttribute("data-running", "");
    await painted();
    start = performance.now();
    const slow = lib.compress(input, { quality: 11 });
    const single = performance.now() - start;
    $("#lane-single").removeAttribute("data-running");
    for (const packed of [fast, slow]) {
      if (!equal(decoder.decompress(packed, { maxOutputSize: input.length }), input)) throw new Error("round trip differs");
    }
    lastRace = { name: NAMES[sample]!, input: input.length, single, parallel, threads, delta: (fast.length / slow.length - 1) * 100 };
    renderRace(lastRace, true);
  } catch (error) {
    for (const lane of ["parallel", "single"]) $(`#lane-${lane}`).removeAttribute("data-running");
    failure(summary, error);
  } finally {
    form.inert = false;
    result.removeAttribute("aria-busy");
  }
}

// ---------------------------------------------------------------- wiring

// One run per demo at a time: the shortcut and the first-view run bypass the form, which is inert while it runs.
const single = (run: () => Promise<void>, result: string) => () =>
  document.getElementById(result)?.hasAttribute("aria-busy") ? Promise.resolve() : run();
const RUNNERS: Record<string, () => Promise<void>> = {
  "panel-compress": single(runCompress, "compress-result"),
  "panel-decompress": single(runDecompress, "decompress-result"),
  "panel-race": single(runRace, "race-result"),
};

/** Runs the demo of the visible tab (Ctrl or Cmd + Enter). */
export function runActive(): void {
  const panel = document.querySelector<HTMLElement>(".demo-tabs > .tab-content:not([hidden])");
  if (panel) void RUNNERS[panel.id]?.();
}

export function setupDemos(): void {
  const cores = Math.min(navigator.hardwareConcurrency || 4, 8);
  for (const id of ["compress-threads", "race-threads"]) {
    const slider = $<HTMLInputElement>(`#${id}`);
    slider.max = String(Math.max(cores, Number(slider.min)));
    slider.value = slider.max;
  }
  const outputs: Array<[string, (v: number) => string]> = [
    ["compress-quality", String],
    ["compress-lgwin", (v) => (2 ** v >= 1 << 20 ? `${2 ** v / (1 << 20)} MiB` : `${2 ** v / 1024} KiB`)],
    ["compress-threads", String],
    ["race-threads", String],
  ];
  for (const [id, format] of outputs) {
    const slider = $<HTMLInputElement>(`#${id}`);
    const show = () => ($(`#${id}-value`).textContent = format(Number(slider.value)));
    slider.addEventListener("input", show);
    show();
  }

  $("#compress-source").addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(".toggle");
    if (!button) return;
    // after toggle-group.js, which clears the pressed button on a second click (VERIFIED in defuss-i18n 0.2.0 docs/assets/demo.js)
    queueMicrotask(() => {
      press($("#compress-source"), button.value);
      showSource(button.value);
    });
  });
  for (const [input, label] of [["compress-file", "compress-file-name"], ["decompress-file", "decompress-file-name"]] as const) {
    const element = $<HTMLInputElement>(`#${input}`);
    element.addEventListener("change", () => ($(`#${label}`).textContent = element.files?.[0]?.name ?? ""));
    const drop = element.previousElementSibling?.matches("label") ? element.previousElementSibling : document.querySelector(`label[for="${input}"]`);
    drop?.addEventListener("dragover", (event) => event.preventDefault());
    drop?.addEventListener("drop", (event) => {
      event.preventDefault();
      const files = (event as DragEvent).dataTransfer?.files;
      if (files?.length) {
        element.files = files;
        element.dispatchEvent(new Event("change"));
      }
    });
  }
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="decompress-source"]')) {
    radio.addEventListener("change", () => showDecompressSource(radio.value));
  }
  $("#compress-form").addEventListener("submit", (event) => (event.preventDefault(), void RUNNERS["panel-compress"]!()));
  $("#decompress-form").addEventListener("submit", (event) => (event.preventDefault(), void RUNNERS["panel-decompress"]!()));
  $("#race-form").addEventListener("submit", (event) => (event.preventDefault(), void RUNNERS["panel-race"]!()));
  $("#compress-to-decoder").addEventListener("click", () => {
    const radio = $<HTMLInputElement>("#decompress-last");
    radio.checked = true;
    showDecompressSource("last");
    $("#tab-decompress").click();
  });

  // Happy path first: each demo runs once with its defaults when it first shows, so results are there to read.
  const ran = new Set<string>();
  const autoRun = (panel: HTMLElement) => {
    if (panel.hidden || ran.has(panel.id) || location.protocol === "file:") return;
    ran.add(panel.id);
    void RUNNERS[panel.id]?.();
  };
  const panels = [...document.querySelectorAll<HTMLElement>(".demo-tabs > .tab-content")];
  let visible = false;
  new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting) || visible;
      if (visible) for (const panel of panels) if (!panel.hidden) autoRun(panel);
    },
    { rootMargin: "0px 0px -20% 0px" },
  ).observe($(".demo-window"));
  const watcher = new MutationObserver(() => {
    if (visible) for (const panel of panels) autoRun(panel);
  });
  for (const panel of panels) watcher.observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  // Script-written results follow a language switch without animating again.
  const idle = () => {
    for (const element of document.querySelectorAll<HTMLElement>("[data-idle]")) {
      if (!element.closest(".result")?.hasAttribute("data-state")) element.textContent = msg(element.dataset.idle!);
    }
  };
  onLocale(() => {
    idle();
    if (lastCompressed) renderCompress(lastCompressed, false);
    if (lastDecompressed) renderDecompress(lastDecompressed, false);
    if (lastRace) renderRace(lastRace, false);
  });
}
