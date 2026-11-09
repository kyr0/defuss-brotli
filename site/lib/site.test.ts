// The site's pure modules: the bilingual source format, routes, number formats, chart data and sample data.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createCodeHighlighter, highlightLine } from "../code.js";
import { highlightCall } from "./callcode.js";
import { expand, plainText, templates } from "./catalog.js";
import { chartOption, chartTable, tableHtml, type Bench, type CliData, type Metric, type View } from "./charts.js";
import { bytes, duration, factor, fill, percent, windowSize } from "./format.js";
import { logLines } from "./logs.js";
import { href, place, preferred } from "./routes.js";

const bench = JSON.parse(readFileSync(new URL("../data/bench.json", import.meta.url), "utf8")) as Bench;
const cli = JSON.parse(readFileSync(new URL("../data/cli.json", import.meta.url), "utf8")) as CliData;

describe("catalog", () => {
  test("turns a data-t element into a target with English content and a template per language", () => {
    const { html, entries } = expand('<p class="x" data-t>Hello <b>you</b><template lang="de">Hallo <b>du</b></template></p>');
    expect(html).toBe('<p class="x" data-i18n-target="t1">Hello <b>you</b></p>');
    expect(entries).toEqual([{ name: "t1", en: "Hello <b>you</b>", de: "Hallo <b>du</b>" }]);
    expect(templates(entries)).toBe(
      '<template data-i18n-for="t1" data-i18n-locale="en">Hello <b>you</b></template>\n<template data-i18n-for="t1" data-i18n-locale="de">Hallo <b>du</b></template>',
    );
  });

  test("keeps given names, and leaves attributes that only start with data-t alone", () => {
    const { html, entries } = expand('<div data-tone="accent"><span data-t="greet">Hi<template lang="de">Hallo</template></span></div>');
    expect(html).toBe('<div data-tone="accent"><span data-i18n-target="greet">Hi</span></div>');
    expect(entries[0]!.name).toBe("greet");
  });

  test("writes both variants of a translated attribute and keeps the English one for pages without JavaScript", () => {
    const { html } = expand('<button aria-label="Copy" de-aria-label="Kopieren">x</button>');
    expect(html).toBe('<button aria-label="Copy" data-i18n-aria-label-en="Copy" data-i18n-aria-label-de="Kopieren">x</button>');
  });

  test("puts a heading anchor in front of a heading with data-anchor, labelled in both languages", () => {
    const { html } = expand('<h2 id="a" data-anchor="perf"><span data-t>Measured<template lang="de">Gemessen</template></span></h2>');
    expect(html).toContain('<a class="heading-anchor" href="#/perf" data-router-link data-route="perf"');
    expect(html).toContain('data-i18n-aria-label-en="Link to section: Measured" data-i18n-aria-label-de="Link zum Abschnitt: Gemessen">§</a>');
  });

  test("rejects duplicate names, a de- attribute without its English one, and a missing translation", () => {
    expect(() => expand('<i data-t="a">1<template lang="de">1</template></i><i data-t="a">2<template lang="de">2</template></i>')).toThrow("duplicate");
    expect(() => expand('<img de-alt="Bild">')).toThrow("de-alt without alt");
    expect(() => expand("<p data-t>English only</p>")).toThrow("untranslated");
  });

  test("plain text of a fragment", () => {
    expect(plainText("<b>a</b>&nbsp;&amp; <i>b</i>")).toBe("a & b");
  });

  test("the page source expands completely", () => {
    const { entries } = expand(readFileSync(new URL("../page.html", import.meta.url), "utf8"));
    expect(entries.length).toBeGreaterThan(100);
    for (const { name, en, de } of entries) {
      expect(en.trim(), name).not.toBe("");
      expect(de.trim(), name).not.toBe("");
    }
  });
});

describe("routes", () => {
  test("a language, a section, or both", () => {
    expect(place("one", { first: "de" })).toEqual({ locale: "de" });
    expect(place("one", { first: "perf" })).toEqual({ section: "perf" });
    expect(place("two", { lang: "en", section: "demo" })).toEqual({ locale: "en", section: "demo" });
    expect(place("two", { lang: "fr", section: "nope" })).toEqual({});
    expect(place("home", {})).toEqual({});
    expect(place(null, {})).toEqual({});
  });

  test("links carry the language", () => {
    expect(href("de", "use")).toBe("#/de/use");
    expect(href("en")).toBe("#/en");
  });

  test("the browser's first language the site has, else English", () => {
    expect(preferred(["fr-FR", "de-CH", "en"])).toBe("de");
    expect(preferred(["fr"])).toBe("en");
    expect(preferred([])).toBe("en");
  });
});

describe("format", () => {
  test("bytes in decimal units with the locale's separator", () => {
    expect(bytes(764)).toBe("764 B");
    expect(bytes(29_175)).toBe("29.2 KB");
    expect(bytes(29_175, "de")).toBe("29,2 KB");
    expect(bytes(2_152_244)).toBe("2.15 MB");
  });

  test("durations, factors, percentages, windows and messages", () => {
    expect(duration(0.42)).toBe("0.42 ms");
    expect(duration(189.4)).toBe("189 ms");
    expect(duration(1670, "de")).toBe("1,67 s");
    expect(factor(4.26)).toBe("4.3");
    expect(factor(38.2)).toBe("38");
    expect(percent(0.05, "en", 2, true)).toBe("+0.05 %");
    expect(percent(-3, "de")).toBe("-3,0 %");
    expect(windowSize(22)).toBe("4 MiB");
    expect(windowSize(16)).toBe("64 KiB");
    expect(fill("{a} of {b}, {c}", { a: 1, b: "two" })).toBe("1 of two, {c}");
  });
});

describe("charts", () => {
  const views: View[] = ["speed", "window", "cli", "download"];
  const metrics: Metric[] = ["multi", "single"];

  test("every view has series and a table with a value per column", () => {
    for (const view of views) {
      for (const metric of metrics) {
        for (const locale of ["en", "de"] as const) {
          const state = { view, input: "html", metric };
          const option = chartOption(bench, cli, state, locale);
          expect((option.series as unknown[]).length, view).toBeGreaterThan(1);
          const table = chartTable(bench, cli, state, locale);
          for (const row of table.rows) expect(row, view).toHaveLength(table.head.length);
        }
      }
    }
  });

  test("the speed view draws lines over qualities 9 to 11: multicore against 1 core and Node.js, 1 core against Node.js", () => {
    const names = (metric: Metric) =>
      (chartOption(bench, cli, { view: "speed", input: "svg", metric }, "en").series as Array<{ name: string; type: string; data: number[] }>).map(
        (s) => {
          expect(s.type).toBe("line");
          expect(s.data).toHaveLength(3);
          return s.name;
        },
      );
    expect(names("multi")).toEqual(["compressParallel(), 8 cores", "compress(), 1 core", "Node.js built-in (C), 1 core"]);
    expect((chartOption(bench, cli, { view: "speed", input: "svg", metric: "multi" }, "en").xAxis as { data: string[] }).data).toEqual(["9", "10", "11"]);
    expect(names("single")).toEqual(["compress(), 1 core", "Node.js built-in (C)"]);
  });

  test("the speed table lists the input's 12 qualities, and this device's timings when measured", () => {
    const device = Array.from({ length: 12 }, (_, q) => q + 1);
    const table = chartTable(bench, cli, { view: "speed", input: "json", metric: "single", device }, "en");
    expect(table.head.at(-1)).toBe("This device");
    expect(table.rows).toHaveLength(13);
    const option = chartOption(bench, cli, { view: "speed", input: "json", metric: "single", device }, "en");
    expect((option.series as Array<{ name: string }>).map((s) => s.name)).toContain("This device");
  });

  test("tables escape their cells", () => {
    expect(tableHtml({ head: ["<a>"], rows: [["x&y"]] })).toContain("<th scope=\"col\">&lt;a&gt;</th>");
    expect(tableHtml({ head: ["h"], rows: [["x&y"]] })).toContain('<th scope="row">x&amp;y</th>');
  });
});

describe("samples and code", () => {
  test("log lines are whole lines, at most the requested size, and the same on every call", () => {
    const a = logLines(64 * 1024);
    expect(a.length).toBeLessThanOrEqual(64 * 1024);
    expect(a.length).toBeGreaterThan(63 * 1024);
    expect(a.at(-1)).toBe(0x0a);
    expect(Buffer.from(logLines(64 * 1024)).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(logLines(64 * 1024, 8)).equals(Buffer.from(a))).toBe(false);
  });

  test("the call line keeps its text and colours every token in both themes", () => {
    const code = 'await compressParallel(input, { quality: 11, name: "<x>" })';
    const html = highlightCall(code);
    expect(html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).toBe(code);
    expect(html).toContain('--code-example-light:#d73a49;--code-example-dark:#f97583">await</span>');
    expect(html).toContain('">11</span>');
  });

  test("the call lines the demos print get Shiki's colours on every character", async () => {
    const highlighter = await createCodeHighlighter();
    // Light and dark colour per character, read from the spans.
    const colours = (html: string) =>
      [...html.matchAll(/<span style="--code-example-light:([^;]+);--code-example-dark:([^"]+)">([^<]*)<\/span>/g)].flatMap(
        ([, light, dark, text]) => [...text!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")].map(() => `${light}/${dark}`.toLowerCase()),
      );
    for (const code of [
      "await compressParallel(input, { quality: 11 })",
      "await compressParallel(input, { quality: 11, lgwin: 22, threads: 8 })",
      "compress(input, { quality: 5, lgwin: 16 })",
      "decompress(bytes) // sample.json.br",
      "decompress(bytes)",
    ]) {
      const shiki = colours(highlightLine(highlighter, code));
      expect(shiki.length).toBe(code.length);
      expect(colours(highlightCall(code))).toEqual(shiki);
    }
  });
});
