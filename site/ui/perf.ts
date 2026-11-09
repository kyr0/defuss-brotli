// The performance chart: one ECharts instance (through defuss-shadcn's chart component) that morphs between views,
// the table of the same numbers, and an optional measurement in the visitor's browser. One instance that changes
// its option beats one chart per view: ECharts animates between views. VERIFIED: the e2e switches every view and
// measures the JSON sample on the test browser.
import { chartOption, chartTable, labels, savingOverGzip, tableHtml, type Bench, type CliData, type ViewState } from "../lib/charts.js";
import { bytes, percent } from "../lib/format.js";
import { compressor } from "./demos.js";
import { $, locale, msg, onLocale, painted, press } from "./shared.js";

interface ChartMount {
  setOption(option: Record<string, unknown>, notMerge?: boolean): void;
}
type Shadcn = { chart?: { mount(el: HTMLElement, option: Record<string, unknown>): ChartMount } };

const SAMPLE_FILES: Record<string, string> = { html: "page.html", json: "data.json", svg: "drawing.svg" };

export function setupPerf(): void {
  const data = JSON.parse($("#perf-data").textContent!) as { bench: Bench; cli: CliData; echarts: [string, string] };
  const { bench, cli } = data;
  const state: ViewState = { view: "quality", input: "html", metric: "size" };
  const devices: Record<string, number[]> = {};
  const chartElement = $("#perf-chart");
  let chart: ChartMount | undefined;
  let measuring = false;

  for (const [key, value] of [["cpu", bench.cpu], ["node", bench.node.replace(/^v/, "")], ["date", bench.measured]]) {
    for (const element of document.querySelectorAll(`[data-perf="${key}"]`)) element.textContent = value!;
  }

  const lead = () => {
    const l = locale();
    if (state.view !== "quality") return msg(`lead-${state.view}`);
    if (state.metric === "time") return msg("lead-quality-time");
    const input = bench.inputs[state.input]!;
    return msg("lead-quality-size", { input: labels(l).labels[state.input]!, saving: percent(savingOverGzip(bench, state.input), l), size: bytes(input.bytes, l) });
  };

  const render = () => {
    const l = locale();
    const view = { ...state, device: state.view === "quality" ? devices[state.input] : undefined };
    $("#perf-lead").textContent = lead();
    $("#perf-table").innerHTML = tableHtml(chartTable(bench, cli, view, l));
    for (const control of document.querySelectorAll<HTMLElement>("[data-for-view]")) control.hidden = control.dataset.forView !== state.view;
    $<HTMLButtonElement>("#perf-device").disabled = measuring || !(state.input in SAMPLE_FILES);
    chart?.setOption(chartOption(bench, cli, view, l), true);
  };

  const mount = () => {
    const shadcn = (globalThis as { df$?: { shadcn?: Shadcn } }).df$?.shadcn;
    if (!shadcn?.chart || !(globalThis as { echarts?: unknown }).echarts) return;
    $("#perf-fallback").hidden = true;
    chart = shadcn.chart.mount(chartElement, chartOption(bench, cli, state, locale()));
    render();
  };

  // ECharts is about 350 KB compressed, so it loads only when the section comes near.
  new IntersectionObserver(
    (entries, observer) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const script = document.createElement("script");
      [script.src, script.integrity] = data.echarts;
      script.crossOrigin = "anonymous";
      script.onload = mount;
      document.head.append(script);
    },
    { rootMargin: "600px 0px" },
  ).observe(chartElement);

  const group = (id: string, apply: (value: string) => void) => {
    const element = $(`#${id}`);
    element.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(".toggle");
      if (!button) return;
      // after toggle-group.js, which clears the pressed button on a second click (VERIFIED in defuss-i18n 0.2.0 docs/assets/demo.js)
      queueMicrotask(() => {
        press(element, button.value);
        apply(button.value);
        render();
      });
    });
  };
  group("perf-view", (value) => (state.view = value as ViewState["view"]));
  group("perf-input", (value) => (state.input = value));
  group("perf-metric", (value) => (state.metric = value as ViewState["metric"]));

  $("#perf-device").addEventListener("click", async () => {
    const button = $<HTMLButtonElement>("#perf-device");
    const key = state.input;
    measuring = true;
    button.disabled = true;
    try {
      const response = await fetch(new URL(`assets/samples/${SAMPLE_FILES[key]}`, document.baseURI));
      const input = new Uint8Array(await response.arrayBuffer());
      const lib = await compressor();
      state.metric = "time";
      press($("#perf-metric"), "time");
      devices[key] = [];
      for (let quality = 0; quality <= 11; quality++) {
        $("#perf-lead").textContent = msg("measuring", { quality });
        await painted();
        const runs = input.length > 100_000 && quality >= 10 ? 1 : 3;
        const times: number[] = [];
        lib.compress(input, { quality });
        for (let i = 0; i < runs; i++) {
          const start = performance.now();
          lib.compress(input, { quality });
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        devices[key]!.push(Math.round(times[runs >> 1]! * 100) / 100);
        if (state.input === key) render();
      }
    } catch (error) {
      $("#perf-lead").textContent = msg("error", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      measuring = false;
      render();
    }
  });

  onLocale(render);
  render();
}
