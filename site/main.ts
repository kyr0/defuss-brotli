// The page script, bundled by site/build.ts into one classic script. It runs after defuss-shadcn's module script
// (both are deferred, so they execute in document order) and uses its df$ for the DOM work of defuss-i18n.
// Without df$ (the CDN unreachable) the page stays readable in English and the demos still run.
// VERIFIED: Chromium 158 blocks a local module script on a file: page and runs a classic one, hence a classic bundle.
import { createRouter } from "defuss-dom-router";
import { createDomI18n, createI18n, validateI18n } from "defuss-i18n/core";
import type { Locale } from "./lib/format.js";
import { href, LOCALES, place, preferred, ROUTES, type Section, type SiteLocale } from "./lib/routes.js";
import { runActive, setupDemos } from "./ui/demos.js";
import { setupPerf } from "./ui/perf.js";
import { $, localeChanged, msg, onLocale, press, reducedMotion, store, stored } from "./ui/shared.js";

type Query = Parameters<typeof createDomI18n>[0];
const df$ = (globalThis as { df$?: Query }).df$;
const LOCALE_KEY = "defuss-brotli-site:locale";
const PM_KEY = "defuss-brotli-site:pm";
const THEME_KEY = "defuss-shadcn-theme";
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// ---------------------------------------------------------------- theme: the OS choice until the visitor picks one

function setupTheme(): void {
  const toggle = $<HTMLInputElement>("#theme-toggle");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    toggle.checked = dark;
    // shaders read their colours again on this event (defuss-shadcn); charts follow the class by themselves
    document.dispatchEvent(new CustomEvent("defuss-theme-change"));
  };
  toggle.checked = document.documentElement.classList.contains("dark");
  toggle.addEventListener("change", () => {
    store(THEME_KEY, JSON.stringify(toggle.checked ? "dark" : "light"));
    apply(toggle.checked);
  });
  system.addEventListener("change", () => {
    if (!stored(THEME_KEY)) apply(system.matches);
  });
}

// ---------------------------------------------------------------- language and routes

function setupLanguageAndRoutes(): void {
  const root = $("#top");
  const select = $<HTMLSelectElement>("[data-app-locale]");
  const initial = (stored(LOCALE_KEY) as SiteLocale | null) ?? preferred(navigator.languages ?? [navigator.language]);
  const i18n = createI18n({ locale: LOCALES.includes(initial) ? initial : "en", fallback: ["en"] });
  let section: Section | undefined;

  const relink = (locale: SiteLocale) => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-router-link]")) {
      link.setAttribute("href", href(locale, link.dataset.route as Section | undefined));
    }
  };
  const marks = () => {
    for (const key of document.querySelectorAll<HTMLElement>("kbd[data-mod]")) key.textContent = mac ? "⌘" : "Ctrl";
  };
  if (df$) {
    createDomI18n(df$).bind(root, i18n);
    const issues = validateI18n(root, { locales: [...LOCALES] });
    root.dataset.i18nIssues = String(issues.length);
    for (const issue of issues) console.warn(`${new Date().toISOString()} WARN i18n ${issue.code} ${issue.message}`);
  }
  i18n.subscribe(({ locale }) => {
    const tag = locale as SiteLocale;
    document.documentElement.lang = tag;
    select.value = tag;
    relink(tag);
    marks();
    localeChanged(tag as Locale);
  });
  select.value = i18n.locale;
  relink(i18n.locale as SiteLocale);
  marks();
  localeChanged(i18n.locale as Locale);
  document.documentElement.lang = i18n.locale;

  // defuss-i18n commits the locale first and reports failed subscribers together; log each, keep the page going
  const switchLocale = (tag: SiteLocale) => {
    try {
      i18n.setLocale(tag);
    } catch (error) {
      for (const cause of (error as AggregateError).errors ?? [error]) {
        console.error(`${new Date().toISOString()} ERROR locale switch failed: ${(cause as Error)?.stack ?? cause}`);
      }
    }
  };
  let first = true;
  const show = (to: { routeId: string | null; params: Record<string, string> }) => {
    const target = place(to.routeId, to.params);
    if (target.locale && target.locale !== i18n.locale) switchLocale(target.locale);
    for (const link of document.querySelectorAll<HTMLAnchorElement>(".mk-header-nav a[data-route]")) {
      if (target.section && link.dataset.route === target.section) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    const moved = target.section !== section;
    section = target.section;
    if (!moved && !first) return;
    // the page opens where its address says at once, after layout; a click glides there
    const behavior: ScrollBehavior = first || reducedMotion() ? "instant" : "smooth";
    const go = () => {
      const element = section ? document.getElementById(section) : null;
      if (element) {
        element.scrollIntoView({ behavior, block: "start" });
        if (!first) element.focus({ preventScroll: true });
      } else if (!first) scrollTo({ top: 0, behavior });
    };
    if (first && section && document.readyState !== "complete") addEventListener("load", go, { once: true });
    else go();
    first = false;
  };
  const router = createRouter({ mode: "hash", scroll: "manual", routes: ROUTES, prepare: ({ to }) => ({ commit: () => show(to) }) });
  router.attachLinks(document);
  select.addEventListener("change", () => {
    const tag = select.value as SiteLocale;
    store(LOCALE_KEY, tag);
    switchLocale(tag);
    if (location.hash.startsWith("#/")) void router.navigate(href(tag, section), { replace: true });
  });
  void router.start().then((result) => {
    if (result.status !== "rejected") return;
    // a page opened from disk has no address the router may own; the same routes still match its hash
    const preview = createRouter({ mode: "hash", routes: ROUTES, baseUrl: "https://preview.invalid/" });
    const follow = () => show(preview.resolve(location.hash.startsWith("#/") ? location.hash : "#/"));
    addEventListener("hashchange", follow);
    follow();
  });
}

// ---------------------------------------------------------------- package manager switch, copy buttons, keys

function setupPackageManagers(): void {
  const groups = [...document.querySelectorAll<HTMLElement>(".pm-switch")];
  const apply = (pm: string) => {
    for (const group of groups) press(group, pm);
    for (const block of document.querySelectorAll<HTMLElement>("[data-pm]")) block.hidden = block.dataset.pm !== pm;
  };
  for (const group of groups) {
    group.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(".toggle");
      if (!button) return;
      // after toggle-group.js, which clears the pressed button on a second click (VERIFIED in defuss-i18n 0.2.0 docs/assets/demo.js)
      queueMicrotask(() => {
        store(PM_KEY, button.value);
        apply(button.value);
      });
    });
  }
  const saved = stored(PM_KEY);
  if (saved && ["bun", "pnpm", "npm", "yarn"].includes(saved)) apply(saved);
}

function setupCopy(): void {
  const status = document.createElement("span");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  document.body.append(status);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", async () => {
      const block = button.parentElement?.querySelector<HTMLElement>(".mockup-code[data-source]:not([hidden])");
      if (!block) return;
      await navigator.clipboard.writeText(block.dataset.source!);
      button.dataset.copied = "";
      status.textContent = msg("copied");
      setTimeout(() => delete button.dataset.copied, 1500);
    });
  }
}

function setupKeys(): void {
  const demo = $("#demo");
  addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    const box = demo.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) return;
    event.preventDefault();
    for (const key of demo.querySelectorAll<HTMLElement>("kbd .kbd, kbd.kbd")) {
      key.dataset.pressed = "";
      setTimeout(() => delete key.dataset.pressed, 160);
    }
    runActive();
  });
}

function setupBrowserCheck(): void {
  const line = $("#browser-check");
  let native = false;
  try {
    new CompressionStream("brotli" as CompressionFormat);
    native = true;
  } catch {
    // not supported: the usual answer, and why this library exists
  }
  const render = () => {
    line.textContent = msg("check-native", { native: msg(native ? "yes" : "no") });
    line.hidden = false;
  };
  onLocale(render);
  render();
}

function boot(): void {
  setupTheme();
  setupLanguageAndRoutes();
  setupPackageManagers();
  setupCopy();
  setupKeys();
  setupBrowserCheck();
  setupDemos();
  setupPerf();
  for (const element of document.querySelectorAll<HTMLElement>("[data-idle]")) element.textContent = msg(element.dataset.idle!);
  document.documentElement.dataset.siteReady = "";
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
