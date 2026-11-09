// The performance views: ECharts options and table rows from the measured data (site/data/*.json). Pure, so the
// build renders the first table into the static page and the browser renders every view from the same code.
// VERIFIED: every view yields series and complete table rows in both languages (site.test.ts), and the e2e switches
// through all five views with ECharts 6.1.0 mounted by defuss-shadcn's chart component.
import { bytes, duration, percent, windowSize, type Locale } from "./format.js";

export interface Timing {
  size: number;
  ms: number;
}
export interface QualityRow extends Timing {
  quality: number;
  parallel: Timing;
  native: Timing;
}
export interface Bench {
  measured: string;
  node: string;
  cpu: string;
  threads: number;
  inputs: Record<string, { label: string; file: string; bytes: number }>;
  quality: Record<string, QualityRow[]>;
  gzip: Record<string, Timing>;
  window: Record<string, Array<Timing & { lgwin: number }>>;
  sizes: Array<{ variant: string; raw: number; gzip: number; br4: number; br11: number; zstd: number }>;
}
export interface CliData {
  source: string;
  rows: Array<{ input: string; node: number; bun: number; brotli: number }>;
}
export type View = "quality" | "workers" | "window" | "cli" | "download";
export type Metric = "size" | "time";
export interface ViewState {
  view: View;
  input: string;
  metric: Metric;
  /** compress() timings per quality measured in this browser, when the visitor asked for them. */
  device?: number[];
}
export interface Table {
  head: string[];
  rows: string[][];
}

const LABELS = {
  en: {
    quality: "Quality",
    qualityAxis: "Quality (0 fastest, 11 smallest)",
    share: "Compressed size, % of the original",
    size: "Size",
    time: "Time to compress",
    window: "Look-back distance",
    relative: "Size, % of the result at 64 KiB",
    wall: "Total time of the command",
    download: "Download size",
    input: "Input",
    import: "What you import",
    device: "This device",
    gzip: "gzip, highest level",
    native: "Node.js built-in (C)",
    single: "compress, 1 core",
    workers: (n: number) => `compressParallel, ${n} cores`,
    uncompressed: "Uncompressed",
    br4: "Brotli level 4, like jsDelivr",
    br11: "Brotli level 11",
    zstd: "zstd, level 19",
    labels: { html: "HTML page", json: "JSON", svg: "SVG, 1 MiB", png: "PNG image" } as Record<string, string>,
  },
  de: {
    quality: "Qualität",
    qualityAxis: "Qualität (0 am schnellsten, 11 am kleinsten)",
    share: "Komprimierte Größe, % des Originals",
    size: "Größe",
    time: "Zeit zum Komprimieren",
    window: "Suchweite",
    relative: "Größe, % des Ergebnisses bei 64 KiB",
    wall: "Gesamtzeit des Befehls",
    download: "Download-Größe",
    input: "Eingabe",
    import: "Was du importierst",
    device: "Dieses Gerät",
    gzip: "gzip, höchste Stufe",
    native: "Node.js eingebaut (C)",
    single: "compress, 1 Kern",
    workers: (n: number) => `compressParallel, ${n} Kerne`,
    uncompressed: "Unkomprimiert",
    br4: "Brotli Stufe 4, wie jsDelivr",
    br11: "Brotli Stufe 11",
    zstd: "zstd, Stufe 19",
    labels: { html: "HTML-Seite", json: "JSON", svg: "SVG, 1 MiB", png: "PNG-Bild" } as Record<string, string>,
  },
};

export const labels = (locale: Locale) => LABELS[locale];
const KEYS = ["html", "json", "svg", "png"];
const QUALITIES = Array.from({ length: 12 }, (_, q) => String(q));
const share = (size: number, input: number) => Math.round((size / input) * 10000) / 100;

const axisMs = (name: string) => ({
  type: "log",
  name,
  nameLocation: "middle",
  nameGap: 56,
  axisLabel: { formatter: (v: number) => (v >= 1000 ? `${v / 1000} s` : `${v} ms`) },
});
const base = () => ({
  animationDurationUpdate: 600,
  grid: { left: 76, right: 24, top: 56, bottom: 64 },
  legend: { top: 0, type: "scroll", textStyle: { fontSize: 14 } },
  tooltip: { trigger: "axis", valueFormatter: undefined as unknown },
  aria: { enabled: true },
  textStyle: { fontSize: 14 },
});

/** Axis names and labels at 14px, the page's smallest text size. */
function readable(option: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["xAxis", "yAxis"]) {
    const axis = option[key] as Record<string, unknown> | undefined;
    if (!axis) continue;
    axis.nameTextStyle = { fontSize: 14 };
    axis.axisLabel = { fontSize: 14, ...(axis.axisLabel as object) };
  }
  return option;
}

/** The ECharts option of one view. */
export function chartOption(bench: Bench, cli: CliData, state: ViewState, locale: Locale): Record<string, unknown> {
  return readable(viewOption(bench, cli, state, locale));
}

function viewOption(bench: Bench, cli: CliData, state: ViewState, locale: Locale): Record<string, unknown> {
  const L = LABELS[locale];
  const option = base();
  const series = (name: string, data: number[], color: string, extra: Record<string, unknown> = {}) => ({
    id: name,
    name,
    data,
    itemStyle: { color },
    lineStyle: { color, width: 3 },
    symbolSize: 8,
    universalTransition: true,
    ...extra,
  });
  if (state.view === "quality") {
    const rows = bench.quality[state.input]!;
    const input = bench.inputs[state.input]!.bytes;
    const xAxis = { type: "category", name: L.qualityAxis, nameLocation: "middle", nameGap: 36, data: QUALITIES };
    if (state.metric === "size") {
      const gzip = share(bench.gzip[state.input]!.size, input);
      return {
        ...option,
        tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v} %` },
        xAxis,
        yAxis: { type: "value", name: L.share, nameLocation: "middle", nameGap: 56, min: 0, axisLabel: { formatter: "{value} %" } },
        series: [
          series("defuss-brotli", rows.map((r) => share(r.size, input)), "var(--chart-1)", { type: "line" }),
          series(L.native, rows.map((r) => share(r.native.size, input)), "var(--chart-4)", {
            type: "line",
            lineStyle: { color: "var(--chart-4)", width: 2, type: "dashed" },
          }),
          series(L.gzip, rows.map(() => gzip), "var(--chart-3)", { type: "line", symbol: "none" }),
        ],
      };
    }
    const timed = [
      series(L.single, rows.map((r) => r.ms), "var(--chart-1)", { type: "line" }),
      series(L.workers(bench.threads), rows.map((r) => r.parallel.ms), "var(--chart-2)", { type: "line" }),
      series(L.native, rows.map((r) => r.native.ms), "var(--chart-4)", {
        type: "line",
        lineStyle: { color: "var(--chart-4)", width: 2, type: "dashed" },
      }),
    ];
    if (state.device) timed.push(series(L.device, state.device, "var(--chart-5)", { type: "line" }));
    return {
      ...option,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => duration(v, locale) },
      xAxis,
      yAxis: axisMs(L.time),
      series: timed,
    };
  }
  if (state.view === "workers") {
    const q11 = KEYS.map((k) => bench.quality[k]!.at(-1)!);
    return {
      ...option,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => duration(v, locale) },
      xAxis: { type: "category", data: KEYS.map((k) => L.labels[k]) },
      yAxis: axisMs(L.time),
      series: [
        series(L.single, q11.map((r) => r.ms), "var(--chart-1)", { type: "bar" }),
        series(L.workers(bench.threads), q11.map((r) => r.parallel.ms), "var(--chart-2)", { type: "bar" }),
        series(L.native, q11.map((r) => r.native.ms), "var(--chart-4)", { type: "bar" }),
      ],
    };
  }
  if (state.view === "window") {
    const keys = Object.keys(bench.window);
    const first = bench.window[keys[0]!]!;
    return {
      ...option,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v} %` },
      xAxis: { type: "category", name: L.window, nameLocation: "middle", nameGap: 36, data: first.map((r) => windowSize(r.lgwin)) },
      yAxis: { type: "value", name: L.relative, nameLocation: "middle", nameGap: 56, scale: true, axisLabel: { formatter: "{value} %" } },
      series: keys.map((k, i) =>
        series(L.labels[k]!, bench.window[k]!.map((r) => share(r.size, bench.window[k]![0]!.size)), `var(--chart-${i + 1})`, {
          type: "line",
        }),
      ),
    };
  }
  if (state.view === "cli") {
    return {
      ...option,
      tooltip: { trigger: "axis", valueFormatter: (v: number) => duration(v, locale) },
      xAxis: { type: "category", data: cli.rows.map((r) => r.input) },
      yAxis: axisMs(L.wall),
      series: [
        series("defuss-brotli, Node.js", cli.rows.map((r) => r.node), "var(--chart-1)", { type: "bar" }),
        series("defuss-brotli, Bun", cli.rows.map((r) => r.bun), "var(--chart-2)", { type: "bar" }),
        series("brotli 1.2.0", cli.rows.map((r) => r.brotli), "var(--chart-4)", { type: "bar" }),
      ],
    };
  }
  const kb = (n: number) => Math.round(n / 100) / 10;
  return {
    ...option,
    tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v} KB` },
    grid: { left: 76, right: 24, top: 56, bottom: 96 },
    xAxis: {
      type: "category",
      data: bench.sizes.map((s) => s.variant.replace("defuss-brotli/", "")),
      axisLabel: { interval: 0, rotate: 0 },
    },
    yAxis: { type: "value", name: `${L.download} (KB)`, nameLocation: "middle", nameGap: 56 },
    series: [
      series(L.gzip, bench.sizes.map((s) => kb(s.gzip)), "var(--chart-3)", { type: "bar" }),
      series(L.br4, bench.sizes.map((s) => kb(s.br4)), "var(--chart-2)", { type: "bar" }),
      series(L.br11, bench.sizes.map((s) => kb(s.br11)), "var(--chart-1)", { type: "bar" }),
    ],
  };
}

/** The same numbers as a table, for screen readers, for copying and for pages without JavaScript. */
export function chartTable(bench: Bench, cli: CliData, state: ViewState, locale: Locale): Table {
  const L = LABELS[locale];
  const b = (n: number) => bytes(n, locale);
  const d = (n: number) => duration(n, locale);
  if (state.view === "quality") {
    const input = bench.inputs[state.input]!.bytes;
    const gzip = bench.gzip[state.input]!;
    const rows = bench.quality[state.input]!.map((r, i) => [
      String(r.quality),
      `${b(r.size)} (${percent((r.size / input) * 100, locale)})`,
      d(r.ms),
      d(r.parallel.ms),
      `${b(r.native.size)}, ${d(r.native.ms)}`,
      ...(state.device ? [state.device[i] === undefined ? "-" : d(state.device[i]!)] : []),
    ]);
    rows.push([L.gzip, `${b(gzip.size)} (${percent((gzip.size / input) * 100, locale)})`, d(gzip.ms), "-", "-", ...(state.device ? ["-"] : [])]);
    return {
      head: [L.quality, L.size, L.single, L.workers(bench.threads), L.native, ...(state.device ? [L.device] : [])],
      rows,
    };
  }
  if (state.view === "workers") {
    return {
      head: [L.input, L.single, L.workers(bench.threads), L.native],
      rows: KEYS.map((k) => {
        const r = bench.quality[k]!.at(-1)!;
        return [`${L.labels[k]}, ${b(bench.inputs[k]!.bytes)}`, d(r.ms), d(r.parallel.ms), d(r.native.ms)];
      }),
    };
  }
  if (state.view === "window") {
    const keys = Object.keys(bench.window);
    return {
      head: [L.window, ...keys.map((k) => L.labels[k]!)],
      rows: bench.window[keys[0]!]!.map((r, i) => [
        windowSize(r.lgwin),
        ...keys.map((k) => `${b(bench.window[k]![i]!.size)}, ${d(bench.window[k]![i]!.ms)}`),
      ]),
    };
  }
  if (state.view === "cli") {
    return {
      head: [L.input, "defuss-brotli, Node.js", "defuss-brotli, Bun", "brotli 1.2.0"],
      rows: cli.rows.map((r) => [r.input, d(r.node), d(r.bun), d(r.brotli)]),
    };
  }
  return {
    head: [L.import, L.uncompressed, L.gzip, L.br4, L.br11, L.zstd],
    rows: bench.sizes.map((s) => [s.variant, b(s.raw), b(s.gzip), b(s.br4), b(s.br11), b(s.zstd)]),
  };
}

/** How much smaller quality 11 is than gzip at level 9 for an input, in percent of gzip's size. */
export function savingOverGzip(bench: Bench, input: string): number {
  const q11 = bench.quality[input]!.at(-1)!.size;
  return (1 - q11 / bench.gzip[input]!.size) * 100;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A table as HTML with the defuss-shadcn table class. */
export function tableHtml({ head, rows }: Table): string {
  const th = head.map((h) => `<th scope="col">${escape(h)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escape(c)}</th>` : `<td>${escape(c)}</td>`)).join("")}</tr>`)
    .join("");
  return `<table class="table perf-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}
