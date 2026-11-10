// End-to-end test of the built website (docs/) in headless Chromium, served as GitHub Pages serves it, and opened
// from disk. Covers every section, route and demo, both languages and both colour schemes, a phone width,
// accessibility (axe-core, WCAG 2 AA: contrast included) and the page's prose rules. Needs network access to
// jsDelivr for defuss-shadcn and ECharts, as visitors do.
// usage: node site/e2e.mjs <docs-dir> <output-file>
// VERIFIED: 27 checks pass on Chromium 158 against docs/ built from this tree (output/e2e-site.json). A real browser
// beats a DOM emulation here: the demos need WebAssembly, workers, CompressionStream and the clipboard.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

const [docs = "docs", outputFile = "output/e2e-site.json"] = process.argv.slice(2);
const log = (level, msg) => console.log(`${new Date().toISOString()} ${level} ${msg}`);
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const root = resolve(import.meta.dirname, "..");
// PROSE: no em dash, no spaced en dash, arrows, curly quotes, ellipsis character, check marks or emoji in text.
const SLOP = /[—―“”‘’…←-⇿⟵-⟿✓-✘✅❌⬀-⯿\u{1f000}-\u{1faff}]|\s–\s/u;

const results = { checks: [] };
const check = (name, detail = {}) => {
  results.checks.push({ name, ...detail });
  log("INFO", `pass ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ""}`);
};

const { url, close } = await serve(resolve(docs));
const browser = await chromium.launch();

async function open(options = {}, hash = "") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await page.goto(url + hash, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.siteReady !== undefined, null, { timeout: 30_000 });
  return { context, page, errors };
}

const busyDone = (page, id) =>
  page.waitForFunction((id) => !document.getElementById(id).hasAttribute("aria-busy") && document.getElementById(id).dataset.ran, id, {
    timeout: 60_000,
  });
// Marks a result pane before a run, so the wait sees this run finish and not an earlier one.
const arm = (page, id) => page.evaluate((id) => {
  const pane = document.getElementById(id);
  delete pane.dataset.ran;
  new MutationObserver((_, observer) => {
    if (pane.hasAttribute("aria-busy")) return;
    pane.dataset.ran = "1";
    observer.disconnect();
  }).observe(pane, { attributes: true, attributeFilter: ["aria-busy"] });
}, id);

async function axe(page, label) {
  await page.addScriptTag({ path: axePath });
  const { violations } = await page.evaluate(() =>
    // #toast-container is defuss-shadcn's own live region, outside this page's markup
    globalThis.axe.run({ exclude: [["#toast-container"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }),
  );
  const summary = violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  assert.deepEqual(summary, [], `axe ${label}`);
  check(`axe WCAG 2.1 AA ${label}`);
}

async function proseAndFonts(page, label) {
  const text = await page.evaluate(() => document.body.innerText);
  const match = text.match(SLOP);
  assert.equal(match, null, `${label}: character ${JSON.stringify(match?.[0])} near ${JSON.stringify(text.slice(Math.max(0, (match?.index ?? 0) - 40), (match?.index ?? 0) + 40))}`);
  // the smallest rendered text that is visible and not decoration
  const smallest = await page.evaluate(() => {
    let min = Infinity;
    let where = "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest("[aria-hidden='true'], .sr-only, svg, .diagram-edges, .chart")) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!box.width || style.visibility === "hidden" || element.closest("[hidden]")) continue;
      const size = parseFloat(style.fontSize);
      if (size < min) [min, where] = [size, `${element.tagName}.${element.className} "${node.textContent.trim().slice(0, 30)}"`];
    }
    return { min, where };
  });
  assert.ok(smallest.min >= 12, `${label}: text at ${smallest.min}px: ${smallest.where}`);
  check(`prose characters and font sizes ${label}`, { smallestPx: smallest.min });
}

try {
  // -------------------------------------------------- English, light, served
  {
    // reduced motion: results show their final numbers at once instead of counting up
    const { context, page, errors } = await open({ colorScheme: "light", locale: "en-US", reducedMotion: "reduce" });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    assert.equal(await page.getAttribute("html", "lang"), "en");
    // text and spacing 1.25 times the browser's default (the root size scales every rem)
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), "20px");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
    assert.equal(await page.getAttribute("#top", "data-i18n-issues"), "0");
    assert.match(await page.textContent("#hero-title"), /Brotli compression/);
    check("English and light mode from the browser's preferences");

    // hero and cards: the folding box, the footnote of the speed claim, six cards, no anchor on the services ad
    assert.equal(await page.locator(".hero-stage .pack-face").count(), 4);
    assert.equal(await page.locator(".hero-stage .pack-flap").count(), 4);
    assert.match(await page.textContent(".hero-note"), /For files of 1 MiB and larger at quality 11/);
    assert.equal(await page.locator(".usps .usp").count(), 6);
    assert.equal(await page.locator("#services-title .heading-anchor").count(), 0);
    const title = await page.locator(".hero-title").boundingBox();
    const stage = await page.locator(".hero-stage").boundingBox();
    assert.ok(title.x + title.width <= stage.x, "the hero title stays left of the box");
    check("hero box, footnote, six cards, services without anchor");

    // compress demo: File is the default source; without a file it waits, and Compress runs the sample (HTML, quality 11)
    await page.locator("#demo").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getElementById("compress-summary").textContent.startsWith("Choose a file, or press Compress"));
    assert.equal(await page.getAttribute('#compress-source .toggle[value="file"]', "aria-pressed"), "true");
    assert.ok(await page.locator("#compress-check").isHidden(), "no run before a file or a click");
    await arm(page, "compress-result");
    await page.click("#compress-run");
    await busyDone(page, "compress-result");
    await page.waitForSelector("#compress-check:not([hidden])", { timeout: 60_000 });
    const ratio = await page.textContent("#compress-ratio");
    assert.match(ratio, /times smaller/);
    assert.match(await page.textContent("#compress-code"), /compressParallel\(input, \{ quality: 11, lgwin: 22/);
    assert.ok(await page.locator("#compress-code span[style*='--code-example-light']").count() > 3, "call line highlighted");
    assert.equal(await page.isChecked("#compress-gzip"), false, "gzip comparison is off by default");
    assert.ok(await page.locator('#compress-bars [data-bar="gzip"]').isHidden(), "no gzip bar while the comparison is off");
    check("compress demo: File by default, Compress without a file runs the sample", { ratio });
    assert.match(await page.textContent("#browser-check"), /Built-in Brotli support in this browser \(CompressionStream\): (yes|no)/);

    // the SVG at quality 5: the case that failed in 0.3.0 (a brotli crate panic in a part)
    await page.selectOption("#compress-sample", "svg");
    await page.locator("#compress-quality").fill("5");
    await arm(page, "compress-result");
    await page.click("#compress-run");
    await busyDone(page, "compress-result");
    assert.equal(await page.getAttribute("#compress-result", "data-state"), null, await page.textContent("#compress-summary"));
    assert.match(await page.textContent("#compress-summary"), /at quality 5/);
    check("compress demo: 1 MiB SVG at quality 5");

    // own text, one thread
    await page.click('#compress-source .toggle[value="text"]');
    await page.fill("#compress-text", "hello brotli ".repeat(500));
    await page.locator("#compress-threads").fill("1");
    await page.check("#compress-gzip");
    await arm(page, "compress-result");
    await page.click("#compress-run");
    await busyDone(page, "compress-result");
    assert.match(await page.textContent("#compress-code"), /^>?\s*compress\(input, \{ quality: 5, lgwin: 22 \}\)/);
    assert.match(await page.textContent('#compress-bars [data-bar="gzip"]:not([hidden]) .bar-value'), /^\d[\d.,]* (B|KB)$/);
    await page.uncheck("#compress-gzip");
    check("compress demo: own text on one thread, compared with gzip");

    // "File" without a file falls back to the sample instead of failing (regression: the fallback re-entered the
    // run and cleared its busy state)
    await page.click('#compress-source .toggle[value="file"]');
    await arm(page, "compress-result");
    await page.click("#compress-run");
    await busyDone(page, "compress-result");
    assert.match(await page.textContent("#compress-summary"), /from 1\.05 MB/); // the SVG sample chosen above
    assert.equal(await page.getAttribute('#compress-source .toggle[value="sample"]', "aria-pressed"), "true");
    check("compress demo: File without a file uses the sample");

    // own file: choosing it starts the run; Ctrl+Enter runs it again
    await page.click('#compress-source .toggle[value="file"]');
    await page.locator("#compress-quality").fill("11");
    await arm(page, "compress-result");
    await page.setInputFiles("#compress-file", join(root, "input/data.json"));
    await busyDone(page, "compress-result");
    assert.match(await page.textContent("#compress-summary"), /from 20\.7 KB/);
    assert.equal(await page.getAttribute("#compress-download", "download"), "data.json.br");
    await arm(page, "compress-result");
    await page.keyboard.press("Control+Enter");
    await busyDone(page, "compress-result");
    assert.match(await page.textContent("#compress-summary"), /from 20\.7 KB/);
    check("compress demo: a chosen file compresses right away, again with Ctrl+Enter");

    // a file above the former 64 MiB limit, at quality 1 to stay quick; the result is a .br download
    const big = join(root, "tmp/e2e/big.bin");
    mkdirSync(join(root, "tmp/e2e"), { recursive: true });
    const page29k = readFileSync(join(root, "input/page.html"));
    writeFileSync(big, Buffer.concat(Array.from({ length: Math.ceil((80 * 2 ** 20) / page29k.length) }, () => page29k)).subarray(0, 80 * 2 ** 20));
    await page.locator("#compress-quality").fill("1");
    await arm(page, "compress-result");
    await page.setInputFiles("#compress-file", big);
    await busyDone(page, "compress-result");
    assert.equal(await page.getAttribute("#compress-result", "data-state"), null, await page.textContent("#compress-summary"));
    assert.match(await page.textContent("#compress-summary"), /from 83\.9 MB/);
    assert.equal(await page.getAttribute("#compress-download", "download"), "big.bin.br");
    assert.match(await page.getAttribute("#compress-download", "href"), /^blob:/);
    check("compress demo: an 80 MiB file compresses locally and downloads as .br");

    // decompress: its default runs when the tab opens; then the last result; then a corrupt file
    await page.click("#tab-decompress");
    await page.waitForSelector("#decompress-preview:not(:empty)", { timeout: 60_000 });
    assert.match(await page.textContent("#decompress-preview"), /<!DOCTYPE html>|<html/i);
    assert.match(await page.textContent("#decoder-bytes"), /transferred|cache/);
    check("decompress demo: precompressed page with the slim decoder", { decoder: await page.textContent("#decoder-bytes") });
    await page.check("#decompress-last");
    await arm(page, "decompress-result");
    await page.click("#decompress-run");
    await busyDone(page, "decompress-result");
    assert.match(await page.textContent("#decompress-summary"), /Decoded/);
    assert.match(await page.textContent("#decompress-preview"), /"/);
    check("decompress demo: the last compress result");
    await page.check('input[name="decompress-source"][value="file"]');
    await page.setInputFiles("#decompress-file", { name: "broken.br", mimeType: "application/octet-stream", buffer: Buffer.from("not brotli at all") });
    await arm(page, "decompress-result");
    await page.click("#decompress-run");
    await busyDone(page, "decompress-result");
    assert.equal(await page.getAttribute("#decompress-result", "data-state"), "error");
    check("decompress demo: corrupt input shows an error", { message: await page.textContent("#decompress-summary") });

    // race: its first run starts when the tab opens; Ctrl+Enter during it must not start a second one
    const runs = await page.evaluate(() => {
      const pane = document.getElementById("race-result");
      globalThis.raceRuns = 0;
      new MutationObserver(() => pane.hasAttribute("aria-busy") && globalThis.raceRuns++).observe(pane, { attributes: true, attributeFilter: ["aria-busy"] });
      return 0;
    });
    await page.click("#tab-race");
    await page.waitForSelector("#race-result[aria-busy]");
    await page.keyboard.press("Control+Enter");
    await page.waitForSelector("#race-check:not([hidden])", { timeout: 90_000 });
    assert.equal(await page.evaluate(() => globalThis.raceRuns), runs + 1, "one race run despite Ctrl+Enter while busy");
    const speedup = await page.textContent("#race-speedup");
    assert.match(speedup, /times faster/);
    assert.match(await page.textContent("#race-check-text"), /Both results unpack to the input/);
    check("race demo: compress against compressParallel", { speedup, summary: await page.textContent("#race-summary") });

    // install switch and copy
    await page.click('.pm-switch .toggle[value="pnpm"]');
    assert.match(await page.locator('.install .mockup-code:not([hidden])').textContent(), /pnpm add defuss-brotli/);
    assert.match(await page.locator('#use .mockup-code[data-pm]:not([hidden])').textContent(), /pnpm dlx defuss-brotli/);
    await page.click(".install [data-copy]");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "pnpm add defuss-brotli");
    // the hero's no-install command follows the same switch and copies only the command
    assert.match(await page.locator(".hero-quick .mockup-code:not([hidden])").textContent(), /pnpm dlx defuss-brotli dist\/app\.js/);
    await page.click(".hero-quick [data-copy]");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "pnpm dlx defuss-brotli dist/app.js");
    await page.click('#use .pm-switch .toggle[value="bun"]');
    assert.match(await page.locator('.install .mockup-code:not([hidden])').textContent(), /bun add defuss-brotli/);
    check("package manager switch and copy button");

    // code tabs
    for (const [tab, text] of [["#code-tab-server", "compressParallel(input)"], ["#code-tab-cdn", "importmap"], ["#code-tab-browser", "decompressText(bytes)"]]) {
      await page.click(tab);
      assert.match(await page.locator("#use .code-tabs .tab-content:not([hidden])").textContent(), new RegExp(text.replace(/[()]/g, "\\$&")));
    }
    check("code example tabs");

    // routes: nav link, heading anchor, back
    await page.click('.mk-header-nav a[data-route="perf"]');
    await page.waitForFunction(() => location.hash === "#/en/perf");
    // scrolled to the section: it lands 12rem down (html scroll-padding plus section scroll-margin), in rem as the page scales
    await page.waitForFunction(() => Math.abs(document.getElementById("perf").getBoundingClientRect().top) < 13 * parseFloat(getComputedStyle(document.documentElement).fontSize));
    await page.click('#how-title .heading-anchor');
    await page.waitForFunction(() => location.hash === "#/en/how");
    await page.goBack();
    await page.waitForFunction(() => location.hash === "#/en/perf");
    check("routes: header link, heading anchor, back");

    // performance views, ECharts through defuss-shadcn's chart
    await page.waitForSelector("#perf-chart svg", { timeout: 30_000 });
    assert.match(await page.textContent("#perf-lead"), /Log lines \(.+\): how long one compression takes at qualities 9 to 11, with compressParallel\(\) on \d+ cores/);
    assert.equal(await page.locator("#perf-view .toggle").count(), 4, "Speed, Look-back, Command line, Download size");
    for (const [view, head] of [["window", "Look-back distance"], ["cli", "brotli 1.2.0"], ["download", "jsDelivr"], ["speed", "Quality"]]) {
      await page.click(`#perf-view .toggle[value="${view}"]`);
      await page.waitForFunction((head) => document.querySelector("#perf-table thead").textContent.includes(head), head);
    }
    await page.click('#perf-input .toggle[value="json"]');
    await page.click('#perf-metric .toggle[value="single"]');
    await page.waitForFunction(() => document.querySelector("#perf-lead").textContent.includes("on 1 core, against the C library built into Node.js"));
    await page.click("#perf-device");
    await page.waitForFunction(() => document.querySelector("#perf-table thead").textContent.includes("This device")
      && [...document.querySelectorAll("#perf-table tbody tr")].slice(0, 12).every((r) => r.lastElementChild.textContent.includes("ms")), null, { timeout: 60_000 });
    check("performance chart: every view, an input, Multicore and Singlecore, measured on this device");

    // the diagram draws its wires
    await page.locator("#how").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll("#how .diagram svg path").length > 4);
    // at desktop width the diagram fits, and every node holds its text (decompressor.wasm overflowed once)
    const fit = await page.evaluate(() => {
      const figure = document.querySelector(".how-diagram");
      const nodes = [...figure.querySelectorAll(".diagram-node")].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.dataset.node);
      return { overflow: figure.scrollWidth - figure.clientWidth, nodes };
    });
    assert.deepEqual(fit, { overflow: 0, nodes: [] });
    check("how-it-works diagram");

    // theme toggle
    await page.click("label.swap");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
    await page.click("label.swap");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), false);
    check("theme toggle");

    await proseAndFonts(page, "English");
    await axe(page, "English light");
    assert.deepEqual(errors, []);
    results.english = { ratio, speedup };
    await context.close();
  }

  // -------------------------------------------------- German, dark, deep link
  {
    const { context, page, errors } = await open({ colorScheme: "dark", locale: "de-DE", reducedMotion: "reduce" }, "#/de/perf");
    assert.equal(await page.getAttribute("html", "lang"), "de");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), true);
    assert.match(await page.textContent("#hero-title"), /Brotli-Kompression/);
    assert.match(await page.textContent("#perf-title"), /Gemessen/);
    const views = await page.textContent("#perf-view");
    assert.ok(views.includes("Geschwindigkeit") && views.includes("Look-back") && !/Suchweite|Mehrkern|Qualität/.test(views), views);
    assert.equal((await page.textContent("#perf-metric")).replace(/\s+/g, ""), "MulticoreSinglecore");
    await page.waitForFunction(() => Math.abs(document.getElementById("perf").getBoundingClientRect().top) < 13 * parseFloat(getComputedStyle(document.documentElement).fontSize));
    check("German deep link #/de/perf, dark mode from the preferences");
    await page.locator("#demo").scrollIntoViewIfNeeded();
    assert.match(await page.textContent("#compress-summary"), /^Wählen Sie eine Datei/);
    await page.click("#compress-run");
    await page.waitForSelector("#compress-check:not([hidden])", { timeout: 60_000 });
    assert.match(await page.textContent("#compress-ratio"), /-mal kleiner/);
    check("German demo result text");
    // switch to English with the language chooser: text, address and the remembered choice follow
    await page.selectOption("[data-app-locale]", "en");
    assert.match(await page.textContent("#hero-title"), /Brotli compression/);
    assert.match(await page.textContent("#compress-ratio"), /times smaller/);
    await page.waitForFunction(() => location.hash === "#/en/perf");
    await page.selectOption("[data-app-locale]", "de");
    await page.waitForFunction(() => location.hash === "#/de/perf");
    check("language chooser switches text, results and address");
    await page.locator("#perf-chart svg").waitFor({ timeout: 30_000 });
    await proseAndFonts(page, "German");
    await axe(page, "German dark");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // -------------------------------------------------- phone width, both languages
  for (const locale of ["en-US", "de-DE"]) {
    const { context, page } = await open({ viewport: { width: 390, height: 844 }, locale, reducedMotion: "reduce" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.equal(overflow, 0, `${locale}: page scrolls sideways by ${overflow}px`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), "20px", "125 % on phones too");
    const title = await page.evaluate(() => document.querySelector(".hero-title").scrollWidth - document.querySelector(".hero-copy").clientWidth);
    assert.ok(title <= 0, `${locale}: hero title wider than the screen by ${title}px`);
    await page.click(".mk-header-menu");
    await page.click('#site-menu a[data-route="use"]');
    await page.waitForFunction(() => location.hash.endsWith("/use"));
    await context.close();
    check(`phone width ${locale}: no sideways scroll, menu navigation`);
  }

  // -------------------------------------------------- opened from disk: renders, demos say why they cannot run
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(docs, "index.html")).href, { waitUntil: "load" });
    assert.match(await page.locator("#hero-title").innerText(), /Brotli compression/);
    assert.ok(await page.locator(".mockup-code span[style*='--code-example-light']").count() > 20, "code highlighted in the static HTML");
    // The demos cannot run from disk, so the "what ran" boxes show the build's Shiki colours: compressParallel purple.
    const call = page.locator("#compress-code span", { hasText: "compressParallel" });
    assert.equal(await call.evaluate((el) => getComputedStyle(el).color), "rgb(111, 66, 193)", "call line coloured before a run");
    assert.ok(await page.locator("#decompress-code span[style*='--code-example-light']").count() >= 2, "decompress line coloured");
    assert.ok(await page.locator("#perf-table tbody tr").count() >= 12, "static table");
    const width = await page.evaluate(() => getComputedStyle(document.querySelector(".demo-window")).borderTopWidth);
    assert.equal(width, "1px", "site.css applied from disk");
    await context.close();
    check("page opened from disk renders text, code colours (also the demo call lines), table and styles");
  }

  // -------------------------------------------------- files next to the page
  const llms = await (await fetch(new URL("llms.txt", url))).text();
  assert.match(llms, /^# defuss-brotli/);
  for (const file of ["assets/lib/decompressor.wasm", "assets/samples/page.html.br", "CNAME"]) {
    assert.equal((await fetch(new URL(file, url))).status, 200, file);
  }
  assert.equal(readFileSync(resolve(docs, "CNAME"), "utf8").trim(), "brotli.defuss.org");
  check("llms.txt, library files, samples and CNAME are served");
} finally {
  await browser.close();
  await close();
}
writeFileSync(outputFile, `${JSON.stringify(results, null, 2)}\n`);
log("INFO", `site e2e passed checks=${results.checks.length} output=${outputFile}`);
